-- Apply AFTER 001. Keeps historical approvals, transactions, and team tables.
begin;
alter table public.music_account_approvals drop constraint music_account_approvals_contract_address_check;
alter table public.music_account_approvals add check (contract_address ~ '^0x[0-9a-f]{40}$' and contract_address<>'0x0000000000000000000000000000000000000000');
alter table public.music_admin_transactions drop constraint music_admin_transactions_contract_address_check;
alter table public.music_admin_transactions add check (contract_address ~ '^0x[0-9a-f]{40}$' and contract_address<>'0x0000000000000000000000000000000000000000');
alter table public.music_admin_transactions drop constraint music_admin_transactions_kind_check;
alter table public.music_admin_transactions add check (kind in ('approve','revoke','accept-owner','return-owner','create-round'));
alter table public.music_admin_transactions add column payload jsonb not null default '{}'::jsonb;
-- The last original check couples wallet presence to job type.
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.music_admin_transactions'::regclass and contype='c' and pg_get_constraintdef(oid) like '%accept-owner%' and pg_get_constraintdef(oid) like '%wallet_address%' loop
 execute format('alter table public.music_admin_transactions drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.music_admin_transactions add check ((kind in ('approve','revoke') and wallet_address is not null) or (kind in ('accept-owner','return-owner','create-round') and wallet_address is null));
create function public.music_v2_sync_approval(p_user text, p_wallet text, p_signer text,
  p_approved boolean, p_revoked boolean, p_enqueue boolean, p_limit integer, p_contract text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.music_account_approvals; t public.music_admin_transactions; paused boolean; count_new integer;
begin
  if p_limit < 1 or p_limit > 1000 then raise exception 'BAD_REQUEST'; end if;
  insert into public.music_admin_signers(signer_address) values(p_signer) on conflict do nothing;
  -- This row serializes creation/rate checks across users and backend processes.
  select s.paused into paused from public.music_admin_signers s where s.signer_address=p_signer for update;
  insert into public.music_account_approvals(privy_user_id,wallet_address,contract_address,blocked) values(p_user,p_wallet,p_contract,exists(select 1 from public.music_account_approvals where wallet_address=p_wallet and blocked)) on conflict do nothing;
  select * into a from public.music_account_approvals where wallet_address=p_wallet and contract_address=p_contract for update;
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
      insert into public.music_admin_transactions(approval_id,kind,signer_address,wallet_address,contract_address)
        values(a.id,'approve',p_signer,p_wallet,p_contract) returning * into t;
    elsif t.state='blocked' and t.nonce is null then
      update public.music_admin_transactions set state='queued',error_code=null,updated_at=now() where id=t.id returning * into t;
    end if;
  end if;
  return jsonb_build_object('approval',to_jsonb(a),'transaction',case when t.id is null then null else to_jsonb(t) end);
end $$;

create function public.music_v2_operator_job(p_kind text,p_wallet text,p_signer text,p_contract text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.music_account_approvals; t public.music_admin_transactions;
begin
  if p_kind not in ('revoke','reenable','accept-owner','return-owner','create-round') then raise exception 'BAD_REQUEST'; end if;
  insert into public.music_admin_signers(signer_address) values(p_signer) on conflict do nothing;
  perform 1 from public.music_admin_signers where signer_address=p_signer for update;
  if p_kind in ('revoke','reenable') then
    if p_wallet is null or p_wallet !~ '^0x[0-9a-f]{40}$' then raise exception 'BAD_REQUEST'; end if;
    select * into a from public.music_account_approvals where wallet_address=p_wallet and contract_address=p_contract for update;
    if p_kind='reenable' and a.id is null then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
    if p_kind='revoke' then
      update public.music_account_approvals set blocked=true,status='revoked',reapproval_authorized=false,updated_at=now() where id=a.id;
      -- Already signed nonces must be reconciled, rather than discarded.
      update public.music_admin_transactions set state='cancelled',updated_at=now()
        where approval_id=a.id and kind='approve' and nonce is null and state in ('queued','blocked');
    else
      update public.music_account_approvals set blocked=false,status='pending',reapproval_authorized=true,updated_at=now() where wallet_address=p_wallet;
    end if;
  elsif p_wallet is not null then raise exception 'BAD_REQUEST';
  end if;
  if p_kind='return-owner' then update public.music_admin_signers set paused=true where signer_address=p_signer; end if;
  select * into t from public.music_admin_transactions where signer_address=p_signer
    and contract_address=p_contract and payload=p_payload
    and kind=(case when p_kind='reenable' then 'approve' else p_kind end)
    and wallet_address is not distinct from p_wallet and state in ('queued','prepared','submitted','uncertain','blocked') limit 1;
  if t.id is null then
    insert into public.music_admin_transactions(approval_id,kind,signer_address,wallet_address,contract_address,payload)
      values(a.id,case when p_kind='reenable' then 'approve' else p_kind end,p_signer,p_wallet,p_contract,p_payload) returning * into t;
  elsif t.state='blocked' and t.nonce is null then
    update public.music_admin_transactions set state='queued',error_code=null,updated_at=now() where id=t.id returning * into t;
  end if;
  return to_jsonb(t);
end $$;

create function public.music_v2_claim_job(p_signer text,p_worker uuid,p_contract text)
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
  if t.contract_address<>p_contract then raise exception 'OLD_CONTRACT_PENDING'; end if;
  return jsonb_build_object('job',to_jsonb(t),'fence',s.lease_version,'paused',s.paused);
end $$;

create function public.music_v2_renew_lease(p_signer text,p_worker uuid,p_fence bigint)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.music_admin_signers set lease_until=clock_timestamp()+interval '30 seconds'
   where signer_address=p_signer and worker_id=p_worker and lease_version=p_fence and lease_until>clock_timestamp();
  return found;
end $$;

create function public.music_v2_update_job(p_job uuid,p_worker uuid,p_fence bigint,p_change jsonb)
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

revoke all on function public.music_v2_sync_approval(text,text,text,boolean,boolean,boolean,integer,text) from public,anon,authenticated;
grant execute on function public.music_v2_sync_approval(text,text,text,boolean,boolean,boolean,integer,text) to service_role;
revoke all on function public.music_v2_operator_job(text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.music_v2_operator_job(text,text,text,text,jsonb) to service_role;
revoke all on function public.music_v2_claim_job(text,uuid,text) from public,anon,authenticated;
grant execute on function public.music_v2_claim_job(text,uuid,text) to service_role;
revoke all on function public.music_v2_renew_lease(text,uuid,bigint) from public,anon,authenticated;
grant execute on function public.music_v2_renew_lease(text,uuid,bigint) to service_role;
revoke all on function public.music_v2_update_job(uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.music_v2_update_job(uuid,uuid,bigint,jsonb) to service_role;

create table public.music_purchase_orders (
 id uuid primary key default gen_random_uuid(),
 app_id text not null default 'cmwnr8etv005h0gjvwth61jyt' check(app_id='cmwnr8etv005h0gjvwth61jyt'),
 chain_id integer not null default 5042002 check(chain_id=5042002),
 contract_address text not null check(contract_address ~ '^0x[0-9a-f]{40}$'),
 privy_user_id text not null check(privy_user_id like 'did:privy:%'),
 wallet_address text not null check(wallet_address ~ '^0x[0-9a-f]{40}$'),
 idempotency_key uuid not null,
 request jsonb not null,
 round jsonb not null,
 transaction jsonb not null,
 nonce bigint not null check(nonce>=0),
 state text not null default 'awaiting_signature' check(state in ('awaiting_signature','prepared','submitted','uncertain','confirmed','failed','cancelled','expired')),
 expires_at timestamptz not null,
 raw_transaction text,
 transaction_hash text unique,
 entry_ids jsonb not null default '[]'::jsonb,
 receipt_block bigint,
 network_fee text,
 error_code text,
 worker_id uuid,
 lease_until timestamptz,
 lease_version bigint not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 broadcast_at timestamptz,
 unique(app_id,privy_user_id,idempotency_key),
 check ((raw_transaction is null)=(transaction_hash is null)),
 check(raw_transaction is null or (raw_transaction ~ '^0x[0-9a-f]+$' and transaction_hash ~ '^0x[0-9a-f]{64}$'))
);
create unique index music_signed_purchase_nonce on public.music_purchase_orders(chain_id,wallet_address,nonce) where raw_transaction is not null;
create unique index music_one_active_purchase on public.music_purchase_orders(chain_id,wallet_address)
 where state in ('awaiting_signature','prepared','submitted','uncertain');
alter table public.music_purchase_orders enable row level security;
revoke all on public.music_purchase_orders from public,anon,authenticated;
grant select,insert,update on public.music_purchase_orders to service_role;

create function public.music_purchase_create(p_user text,p_wallet text,p_contract text,p_key uuid,p_request jsonb,p_tx jsonb,p_expires timestamptz,p_round jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.music_purchase_orders;
begin
 perform pg_advisory_xact_lock(hashtextextended('music-purchase:'||p_wallet,0));
 update public.music_purchase_orders set state='expired',updated_at=now() where wallet_address=p_wallet and state='awaiting_signature' and expires_at<=now();
 select * into o from public.music_purchase_orders where privy_user_id=p_user and idempotency_key=p_key;
 if o.id is not null then
   if o.wallet_address<>p_wallet or o.contract_address<>p_contract or o.request<>p_request then raise exception 'ORDER_CONFLICT'; end if;
   return to_jsonb(o);
 end if;
 if exists(select 1 from public.music_purchase_orders where wallet_address=p_wallet and state in ('awaiting_signature','prepared','submitted','uncertain')) then raise exception 'ORDER_PENDING'; end if;
 if exists(select 1 from public.music_purchase_orders where wallet_address=p_wallet and raw_transaction is not null and nonce>=(p_tx->>'nonce')::bigint) then raise exception 'ORDER_PENDING'; end if;
 insert into public.music_purchase_orders(privy_user_id,wallet_address,contract_address,idempotency_key,request,transaction,nonce,expires_at,round)
 values(p_user,p_wallet,p_contract,p_key,p_request,p_tx,(p_tx->>'nonce')::bigint,p_expires,p_round) returning * into o;
 return to_jsonb(o);
end $$;

create function public.music_purchase_action(p_id uuid,p_user text,p_wallet text,p_contract text,p_action text,p_raw text default null,p_hash text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.music_purchase_orders;
begin
 select * into o from public.music_purchase_orders where id=p_id and privy_user_id=p_user and wallet_address=p_wallet and contract_address=p_contract for update;
 if o.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
 if p_action='signed' then
   if o.raw_transaction is not null then
     if o.raw_transaction<>p_raw or o.transaction_hash<>p_hash then raise exception 'ORDER_CONFLICT'; end if;
     return to_jsonb(o);
   end if;
   if o.state<>'awaiting_signature' or o.expires_at<=now() then raise exception 'ORDER_EXPIRED'; end if;
   update public.music_purchase_orders set state='prepared',raw_transaction=p_raw,transaction_hash=p_hash,updated_at=now() where id=p_id returning * into o;
 elsif p_action='cancel' then
   if o.state='awaiting_signature' then
     update public.music_purchase_orders set state='cancelled',updated_at=now() where id=p_id returning * into o;
   elsif o.state not in ('cancelled','expired') then raise exception 'ORDER_PENDING'; end if;
 else raise exception 'BAD_REQUEST'; end if;
 return to_jsonb(o);
end $$;

create function public.music_purchase_claim(p_worker uuid,p_contract text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.music_purchase_orders;
begin
 select * into o from public.music_purchase_orders where contract_address=p_contract and state in ('prepared','submitted','uncertain')
 and (lease_until is null or lease_until<=clock_timestamp()) order by updated_at,id for update skip locked limit 1;
 if o.id is null then return null; end if;
 update public.music_purchase_orders set worker_id=p_worker,lease_until=clock_timestamp()+interval '30 seconds',lease_version=lease_version+1 where id=o.id returning * into o;
 return to_jsonb(o);
end $$;

create function public.music_purchase_update(p_id uuid,p_worker uuid,p_fence bigint,p_change jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.music_purchase_orders;
begin
 select * into o from public.music_purchase_orders where id=p_id for update;
 if o.worker_id is distinct from p_worker or o.lease_version<>p_fence or o.lease_until is null or o.lease_until<=clock_timestamp() then raise exception 'LEASE_LOST'; end if;
 update public.music_purchase_orders set state=coalesce(p_change->>'state',state),error_code=p_change->>'error_code',
 entry_ids=coalesce(p_change->'entry_ids',entry_ids),receipt_block=coalesce((p_change->>'receipt_block')::bigint,receipt_block),network_fee=coalesce(p_change->>'network_fee',network_fee),
 broadcast_at=case when p_change->>'state'='submitted' then clock_timestamp() else broadcast_at end,
 updated_at=clock_timestamp(),lease_until=null where id=p_id returning * into o;
 return to_jsonb(o);
end $$;

revoke all on function public.music_purchase_create(text,text,text,uuid,jsonb,jsonb,timestamptz,jsonb) from public,anon,authenticated;
revoke all on function public.music_purchase_action(uuid,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.music_purchase_claim(uuid,text) from public,anon,authenticated;
revoke all on function public.music_purchase_update(uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.music_purchase_create(text,text,text,uuid,jsonb,jsonb,timestamptz,jsonb) to service_role;
grant execute on function public.music_purchase_action(uuid,text,text,text,text,text,text) to service_role;
grant execute on function public.music_purchase_claim(uuid,text) to service_role;
grant execute on function public.music_purchase_update(uuid,uuid,bigint,jsonb) to service_role;

-- Keep the legacy local configuration safe during preparation and rollback.
-- Its original RPC signatures now explicitly select the historical deployment.
create or replace function public.music_sync_approval(p_user text,p_wallet text,p_signer text,p_approved boolean,p_revoked boolean,p_enqueue boolean default false,p_limit integer default 20)
returns jsonb language sql security definer set search_path='' as $$
 select public.music_v2_sync_approval(p_user,p_wallet,p_signer,p_approved,p_revoked,p_enqueue,p_limit,'0x003043208750d205f98ac1d9ae670d2d2a19797c');
$$;
create or replace function public.music_operator_job(p_kind text,p_wallet text,p_signer text)
returns jsonb language sql security definer set search_path='' as $$
 select public.music_v2_operator_job(p_kind,p_wallet,p_signer,'0x003043208750d205f98ac1d9ae670d2d2a19797c','{}'::jsonb);
$$;
create or replace function public.music_claim_job(p_signer text,p_worker uuid)
returns jsonb language sql security definer set search_path='' as $$
 select public.music_v2_claim_job(p_signer,p_worker,'0x003043208750d205f98ac1d9ae670d2d2a19797c');
$$;
revoke all on function public.music_sync_approval(text,text,text,boolean,boolean,boolean,integer) from public,anon,authenticated;
revoke all on function public.music_operator_job(text,text,text) from public,anon,authenticated;
revoke all on function public.music_claim_job(text,uuid) from public,anon,authenticated;
grant execute on function public.music_sync_approval(text,text,text,boolean,boolean,boolean,integer) to service_role;
grant execute on function public.music_operator_job(text,text,text) to service_role;
grant execute on function public.music_claim_job(text,uuid) to service_role;
commit;
