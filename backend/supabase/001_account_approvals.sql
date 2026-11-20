-- Apply once in the EXISTING project's SQL editor. Does not alter existing objects.
-- All names are deliberately prefixed. A collision aborts the whole migration.
begin;

create table public.music_account_approvals (
  id uuid primary key default gen_random_uuid(),
  app_id text not null default 'cmwnr8etv005h0gjvwth61jyt' check (app_id = 'cmwnr8etv005h0gjvwth61jyt'),
  chain_id integer not null default 5042002 check (chain_id = 5042002),
  contract_address text not null default '0x003043208750d205f98ac1d9ae670d2d2a19797c' check (contract_address = '0x003043208750d205f98ac1d9ae670d2d2a19797c'),
  privy_user_id text not null check (privy_user_id like 'did:privy:%' and length(privy_user_id) <= 200),
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-f]{40}$' and wallet_address <> '0x0000000000000000000000000000000000000000'),
  status text not null default 'pending' check (status in ('pending','approved','revoked')),
  blocked boolean not null default false,
  reapproval_authorized boolean not null default false,
  confirmed_block bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (app_id, chain_id, contract_address, wallet_address)
);

create table public.music_admin_signers (
  chain_id integer not null default 5042002 check (chain_id = 5042002),
  signer_address text not null check (signer_address ~ '^0x[0-9a-f]{40}$'),
  worker_id uuid,
  lease_until timestamptz,
  lease_version bigint not null default 0,
  next_nonce bigint not null default 0 check (next_nonce >= 0),
  paused boolean not null default false,
  primary key (chain_id, signer_address)
);

create table public.music_admin_transactions (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid references public.music_account_approvals(id),
  kind text not null check (kind in ('approve','revoke','accept-owner','return-owner')),
  chain_id integer not null default 5042002 check (chain_id = 5042002),
  contract_address text not null default '0x003043208750d205f98ac1d9ae670d2d2a19797c' check (contract_address = '0x003043208750d205f98ac1d9ae670d2d2a19797c'),
  signer_address text not null,
  wallet_address text check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  state text not null default 'queued' check (state in ('queued','prepared','submitted','confirmed','reverted','uncertain','blocked','cancelled')),
  nonce bigint check (nonce >= 0),
  raw_transaction text,
  transaction_hash text unique check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  error_code text,
  receipt_block bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  broadcast_at timestamptz,
  foreign key (chain_id, signer_address) references public.music_admin_signers(chain_id, signer_address),
  unique (chain_id, signer_address, nonce),
  check ((raw_transaction is null) = (transaction_hash is null)),
  check (raw_transaction is null or (raw_transaction ~ '^0x[0-9a-f]+$' and nonce is not null)),
  check ((kind in ('approve','revoke') and wallet_address is not null) or (kind in ('accept-owner','return-owner') and wallet_address is null))
);
create unique index music_one_active_approval on public.music_admin_transactions(approval_id)
  where kind = 'approve' and state in ('queued','prepared','submitted','uncertain','blocked');
create index music_admin_work on public.music_admin_transactions(signer_address, created_at);

alter table public.music_account_approvals enable row level security;
alter table public.music_admin_signers enable row level security;
alter table public.music_admin_transactions enable row level security;
revoke all on public.music_account_approvals, public.music_admin_signers, public.music_admin_transactions from public, anon, authenticated;
grant select, insert, update on public.music_account_approvals, public.music_admin_signers, public.music_admin_transactions to service_role;

create function public.music_sync_approval(p_user text, p_wallet text, p_signer text,
  p_approved boolean, p_revoked boolean, p_enqueue boolean default false, p_limit integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.music_account_approvals; t public.music_admin_transactions; paused boolean; count_new integer;
begin
  if p_limit < 1 or p_limit > 1000 then raise exception 'BAD_REQUEST'; end if;
  insert into public.music_admin_signers(signer_address) values(p_signer) on conflict do nothing;
  -- This row serializes creation/rate checks across users and backend processes.
  select s.paused into paused from public.music_admin_signers s where s.signer_address=p_signer for update;
  insert into public.music_account_approvals(privy_user_id,wallet_address) values(p_user,p_wallet) on conflict do nothing;
  select * into a from public.music_account_approvals where wallet_address=p_wallet for update;
  if a.privy_user_id <> p_user then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
  if not p_approved and (a.status='approved' or (p_revoked and not a.reapproval_authorized)) then
    a.blocked := true;
  end if;
  a.status := case when a.blocked then 'revoked' when p_approved then 'approved' else 'pending' end;
  update public.music_account_approvals set blocked=a.blocked,status=a.status,updated_at=now() where id=a.id returning * into a;
  select * into t from public.music_admin_transactions where approval_id=a.id and kind='approve' order by created_at desc,id desc limit 1;
  if p_enqueue and not a.blocked and not p_approved then
    if paused then raise exception 'OWNER_NOT_READY'; end if;
    if t.id is null or t.state in ('reverted','cancelled','confirmed') then
      if (select count(*) from public.music_admin_transactions where approval_id=a.id and created_at>now()-interval '1 hour') >= 3 then raise exception 'RATE_LIMITED'; end if;
      select count(distinct approval_id) into count_new from public.music_admin_transactions
        where kind='approve' and signer_address=p_signer and created_at>now()-interval '1 hour';
      if count_new>=p_limit and not exists(select 1 from public.music_admin_transactions where approval_id=a.id and created_at>now()-interval '1 hour') then raise exception 'RATE_LIMITED'; end if;
      insert into public.music_admin_transactions(approval_id,kind,signer_address,wallet_address)
        values(a.id,'approve',p_signer,p_wallet) returning * into t;
    elsif t.state='blocked' and t.nonce is null then
      update public.music_admin_transactions set state='queued',error_code=null,updated_at=now() where id=t.id returning * into t;
    end if;
  end if;
  return jsonb_build_object('approval',to_jsonb(a),'transaction',case when t.id is null then null else to_jsonb(t) end);
end $$;

create function public.music_operator_job(p_kind text,p_wallet text,p_signer text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.music_account_approvals; t public.music_admin_transactions;
begin
  if p_kind not in ('revoke','reenable','accept-owner','return-owner') then raise exception 'BAD_REQUEST'; end if;
  insert into public.music_admin_signers(signer_address) values(p_signer) on conflict do nothing;
  perform 1 from public.music_admin_signers where signer_address=p_signer for update;
  if p_kind in ('revoke','reenable') then
    if p_wallet is null or p_wallet !~ '^0x[0-9a-f]{40}$' then raise exception 'BAD_REQUEST'; end if;
    select * into a from public.music_account_approvals where wallet_address=p_wallet for update;
    if p_kind='reenable' and a.id is null then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
    if p_kind='revoke' then
      update public.music_account_approvals set blocked=true,status='revoked',reapproval_authorized=false,updated_at=now() where id=a.id;
      -- Already signed nonces must be reconciled, rather than discarded.
      update public.music_admin_transactions set state='cancelled',updated_at=now()
        where approval_id=a.id and kind='approve' and nonce is null and state in ('queued','blocked');
    else
      update public.music_account_approvals set blocked=false,status='pending',reapproval_authorized=true,updated_at=now() where id=a.id;
    end if;
  elsif p_wallet is not null then raise exception 'BAD_REQUEST';
  end if;
  if p_kind='return-owner' then update public.music_admin_signers set paused=true where signer_address=p_signer; end if;
  select * into t from public.music_admin_transactions where signer_address=p_signer
    and kind=(case when p_kind='reenable' then 'approve' else p_kind end)
    and wallet_address is not distinct from p_wallet and state in ('queued','prepared','submitted','uncertain','blocked') limit 1;
  if t.id is null then
    insert into public.music_admin_transactions(approval_id,kind,signer_address,wallet_address)
      values(a.id,case when p_kind='reenable' then 'approve' else p_kind end,p_signer,p_wallet) returning * into t;
  elsif t.state='blocked' and t.nonce is null then
    update public.music_admin_transactions set state='queued',error_code=null,updated_at=now() where id=t.id returning * into t;
  end if;
  return to_jsonb(t);
end $$;

create function public.music_claim_job(p_signer text,p_worker uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.music_admin_signers; t public.music_admin_transactions;
begin
  insert into public.music_admin_signers(signer_address) values(p_signer) on conflict do nothing;
  select * into s from public.music_admin_signers where signer_address=p_signer for update;
  if s.worker_id is distinct from p_worker and s.lease_until>clock_timestamp() then return null; end if;
  update public.music_admin_signers set worker_id=p_worker,lease_until=clock_timestamp()+interval '30 seconds',lease_version=lease_version+1
    where signer_address=p_signer returning * into s;
  -- Resolve every reserved nonce before signing the next job.
  select * into t from public.music_admin_transactions where signer_address=p_signer
    and ((nonce is not null and state not in ('confirmed','reverted','cancelled')) or state='queued')
    order by (nonce is not null) desc,nonce asc nulls last,created_at,id limit 1;
  if t.id is null then return null; end if;
  return jsonb_build_object('job',to_jsonb(t),'fence',s.lease_version,'paused',s.paused);
end $$;

create function public.music_renew_lease(p_signer text,p_worker uuid,p_fence bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.music_admin_signers set lease_until=clock_timestamp()+interval '30 seconds'
   where signer_address=p_signer and worker_id=p_worker and lease_version=p_fence and lease_until>clock_timestamp();
  return found;
end $$;

create function public.music_update_job(p_job uuid,p_worker uuid,p_fence bigint,p_change jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.music_admin_transactions; s public.music_admin_signers;
begin
  select * into t from public.music_admin_transactions where id=p_job;
  select * into s from public.music_admin_signers where signer_address=t.signer_address for update;
  select * into t from public.music_admin_transactions where id=p_job for update;
  if s.worker_id is distinct from p_worker or s.lease_version<>p_fence or s.lease_until<=clock_timestamp() then raise exception 'LEASE_LOST'; end if;
  if t.state in ('confirmed','reverted','cancelled') then return to_jsonb(t); end if;
  if p_change ? 'nonce' then
    if t.nonce is not null and t.nonce<>(p_change->>'nonce')::bigint then raise exception 'NONCE_CONFLICT'; end if;
    if t.nonce is null then
      t.nonce:=greatest((p_change->>'nonce')::bigint,s.next_nonce);
      update public.music_admin_signers set next_nonce=t.nonce+1 where signer_address=t.signer_address;
    end if;
  end if;
  if t.raw_transaction is not null and p_change ? 'raw_transaction' and t.raw_transaction<>p_change->>'raw_transaction' then raise exception 'PREPARED_TRANSACTION_IMMUTABLE'; end if;
  update public.music_admin_transactions set
    nonce=t.nonce,state=coalesce(p_change->>'state',state),
    raw_transaction=coalesce(p_change->>'raw_transaction',raw_transaction),
    transaction_hash=coalesce(p_change->>'transaction_hash',transaction_hash),
    error_code=case when p_change ? 'error_code' then p_change->>'error_code' else error_code end,
    receipt_block=coalesce((p_change->>'receipt_block')::bigint,receipt_block),
    broadcast_at=case when p_change->>'state'='submitted' then clock_timestamp() else broadcast_at end,
    updated_at=clock_timestamp()
    where id=p_job returning * into t;
  if t.state='confirmed' then
    if t.kind='approve' then
      update public.music_account_approvals set status=case when blocked or p_change->>'approved'='false' then 'revoked' else 'approved' end,
        blocked=blocked or p_change->>'approved'='false',reapproval_authorized=false,
        confirmed_block=t.receipt_block,updated_at=now() where id=t.approval_id;
    elsif t.kind='revoke' then
      update public.music_account_approvals set status='revoked',blocked=true,reapproval_authorized=false,confirmed_block=t.receipt_block,updated_at=now() where id=t.approval_id;
    elsif t.kind='accept-owner' then update public.music_admin_signers set paused=false where signer_address=t.signer_address;
    end if;
  end if;
  return to_jsonb(t);
end $$;

-- Functions are server-only too: definer privileges must never be exposed through PostgREST.
revoke all on function public.music_sync_approval(text,text,text,boolean,boolean,boolean,integer) from public,anon,authenticated;
revoke all on function public.music_operator_job(text,text,text) from public,anon,authenticated;
revoke all on function public.music_claim_job(text,uuid) from public,anon,authenticated;
revoke all on function public.music_renew_lease(text,uuid,bigint) from public,anon,authenticated;
revoke all on function public.music_update_job(uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.music_sync_approval(text,text,text,boolean,boolean,boolean,integer) to service_role;
grant execute on function public.music_operator_job(text,text,text) to service_role;
grant execute on function public.music_claim_job(text,uuid) to service_role;
grant execute on function public.music_renew_lease(text,uuid,bigint) to service_role;
grant execute on function public.music_update_job(uuid,uuid,bigint,jsonb) to service_role;
commit;
