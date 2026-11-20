-- Apply once after 004. No contract changes or automatic submissions.
begin;
alter table public.music_purchase_orders add column action_kind text not null default 'purchase' check(action_kind in ('purchase','claim_entry'));
alter table public.music_purchase_orders add column result jsonb;
create function public.music_action_identity_immutable() returns trigger language plpgsql set search_path='' as $$ begin
 if new.action_kind<>old.action_kind or new.request<>old.request or new.wallet_address<>old.wallet_address or new.privy_user_id<>old.privy_user_id or new.contract_address<>old.contract_address or new.transaction<>old.transaction or new.nonce<>old.nonce then raise exception 'ACTION_IMMUTABLE'; end if;
 return new; end $$;
create trigger music_action_identity before update on public.music_purchase_orders for each row execute function public.music_action_identity_immutable();
create function public.music_wallet_action_create(p_user text,p_wallet text,p_contract text,p_key uuid,p_request jsonb,p_tx jsonb,p_expires timestamptz,p_round jsonb,p_kind text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.music_purchase_orders;
begin
 if p_kind not in ('purchase','claim_entry') then raise exception 'BAD_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended('music-purchase:'||p_wallet,0));
 update public.music_purchase_orders set state='expired',updated_at=now() where wallet_address=p_wallet and state='awaiting_signature' and expires_at<=now();
 select * into o from public.music_purchase_orders where privy_user_id=p_user and idempotency_key=p_key;
 if o.id is not null then
   if o.wallet_address<>p_wallet or o.contract_address<>p_contract or o.request<>p_request or o.action_kind<>p_kind then raise exception 'ORDER_CONFLICT'; end if;
   return to_jsonb(o);
 end if;
 if exists(select 1 from public.music_purchase_orders where wallet_address=p_wallet and state in ('awaiting_signature','prepared','submitted','uncertain')) then raise exception 'ORDER_PENDING'; end if;
 if exists(select 1 from public.music_purchase_orders where wallet_address=p_wallet and raw_transaction is not null and nonce>=(p_tx->>'nonce')::bigint) then raise exception 'ORDER_PENDING'; end if;
 insert into public.music_purchase_orders(privy_user_id,wallet_address,contract_address,idempotency_key,request,transaction,nonce,expires_at,round,action_kind)
 values(p_user,p_wallet,p_contract,p_key,p_request,p_tx,(p_tx->>'nonce')::bigint,p_expires,p_round,p_kind) returning * into o;
 return to_jsonb(o);
end $$;
create or replace function public.music_purchase_create(p_user text,p_wallet text,p_contract text,p_key uuid,p_request jsonb,p_tx jsonb,p_expires timestamptz,p_round jsonb)
returns jsonb language sql security definer set search_path='' as $$
 select public.music_wallet_action_create(p_user,p_wallet,p_contract,p_key,p_request,p_tx,p_expires,p_round,'purchase');
$$;
create or replace function public.music_purchase_update(p_id uuid,p_worker uuid,p_fence bigint,p_change jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.music_purchase_orders;
begin
 select * into o from public.music_purchase_orders where id=p_id for update;
 if o.worker_id is distinct from p_worker or o.lease_version<>p_fence or o.lease_until is null or o.lease_until<=clock_timestamp() then raise exception 'LEASE_LOST'; end if;
 update public.music_purchase_orders set state=coalesce(p_change->>'state',state),error_code=p_change->>'error_code',
 result=coalesce(p_change->'result',result),entry_ids=coalesce(p_change->'entry_ids',entry_ids),receipt_block=coalesce((p_change->>'receipt_block')::bigint,receipt_block),network_fee=coalesce(p_change->>'network_fee',network_fee),
 broadcast_at=case when p_change->>'state'='submitted' then clock_timestamp() else broadcast_at end,
 updated_at=clock_timestamp(),lease_until=null where id=p_id returning * into o;
 return to_jsonb(o);
end $$;
-- Extend the same fenced administrator queue, preserving approval/ownership behavior.
alter table public.music_admin_transactions drop constraint music_admin_transactions_kind_check;
alter table public.music_admin_transactions add check(kind in ('approve','revoke','accept-owner','return-owner','create-round','submit-order','advance-settlement','restart-order','cancel-pool'));
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.music_admin_transactions'::regclass and contype='c' and pg_get_constraintdef(oid) like '%create-round%' and pg_get_constraintdef(oid) like '%wallet_address%' loop execute format('alter table public.music_admin_transactions drop constraint %I',c.conname); end loop;
end $$;
alter table public.music_admin_transactions add check((kind in ('approve','revoke') and wallet_address is not null) or (kind not in ('approve','revoke') and wallet_address is null));
create or replace function public.music_v2_operator_job(p_kind text,p_wallet text,p_signer text,p_contract text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.music_account_approvals; t public.music_admin_transactions;
begin
  if p_kind not in ('revoke','reenable','accept-owner','return-owner','create-round','submit-order','advance-settlement','restart-order','cancel-pool') then raise exception 'BAD_REQUEST'; end if;
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
create table public.music_result_evidence (
 evidence_hash text primary key check(evidence_hash ~ '^0x[0-9a-f]{64}$'),
 contract_address text not null check(contract_address ~ '^0x[0-9a-f]{40}$'),
 document jsonb not null check(jsonb_typeof(document)='object' and document->>'source'='sample'),
 created_at timestamptz not null default now()
);
alter table public.music_result_evidence enable row level security;
revoke all on public.music_result_evidence from public,anon,authenticated;
grant select,insert on public.music_result_evidence to service_role;
create or replace view public.music_live_claims with (security_invoker=true) as
select chain_id,contract_address,block_number,transaction_hash,log_index,(args->>'entryId')::numeric as entry_id,(args->>'amount')::numeric as amount,(args->>'refund')::boolean as refund,lower(args->>'recipient') as recipient,block_hash
from public.music_chain_events where event_name='EntryClaimed';
create function public.music_claim_records(p_contract text,p_entries jsonb) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('entryId',entry_id::text,'amount',amount::text,'refund',refund,'recipient',recipient,'transactionHash',transaction_hash,'block',block_number::text,'blockHash',block_hash)),'[]'::jsonb) from public.music_live_claims where contract_address=p_contract and chain_id=5042002 and entry_id::text in(select jsonb_array_elements_text(p_entries));
$$;
create function public.music_settlement_entries(p_contract text,p_pool text,p_block numeric,p_after numeric default 0) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(row),'[]'::jsonb) from (
 select jsonb_build_object('id',args->>'entryId','guess',args->>'guess','paid',args->>'paid','firstTicketId',args->>'firstTicketId','spots',args->>'spots','purchasedAt',args->>'purchasedAt') as row
 from public.music_chain_events where contract_address=p_contract and chain_id=5042002 and event_name='EntryRecorded' and lower(args->>'pool')=p_pool and block_number<=p_block and (args->>'entryId')::numeric>p_after order by (args->>'entryId')::numeric limit 500) q;
$$;
create function public.music_step6_status() returns integer language sql stable security invoker set search_path='' as $$select 1$$;
revoke all on function public.music_wallet_action_create(text,text,text,uuid,jsonb,jsonb,timestamptz,jsonb,text),public.music_claim_records(text,jsonb),public.music_settlement_entries(text,text,numeric,numeric),public.music_step6_status(),public.music_action_identity_immutable() from public,anon,authenticated;
grant execute on function public.music_wallet_action_create(text,text,text,uuid,jsonb,jsonb,timestamptz,jsonb,text),public.music_claim_records(text,jsonb),public.music_settlement_entries(text,text,numeric,numeric),public.music_step6_status() to service_role;
commit;
