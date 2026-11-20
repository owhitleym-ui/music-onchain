-- Apply once after 005. Register a verified V2 deployment during activation.
begin;
create table public.music_deployments (
 deployment_id text primary key check(deployment_id ~ '^[a-z0-9_-]+$'),chain_id integer not null check(chain_id=5042002),
 contract_address text unique not null check(contract_address ~ '^0x[0-9a-f]{40}$'),model_version integer not null check(model_version in (1,2)),
 creation_block numeric(20,0) not null check(creation_block>=0),runtime_sha256 text not null check(runtime_sha256 ~ '^[0-9a-f]{64}$'),
 active boolean not null default false,manifest jsonb not null,created_at timestamptz not null default now()
);
create unique index music_one_active_deployment on public.music_deployments(chain_id) where active;
alter table public.music_deployments enable row level security;
revoke all on public.music_deployments from public,anon,authenticated;
grant select on public.music_deployments to service_role;
insert into public.music_deployments(deployment_id,chain_id,contract_address,model_version,creation_block,runtime_sha256,active,manifest)
values('atomic-v1',5042002,'0x0e45cf9200c27af84ba175a8f6723ffd8dd8b083',1,73100560,'2df546ef4ef74033407294fe6ac0afeb0a1e3a662fe22ace4e398c964ba56c9b',true,'{"chainId": 5042002, "address": "0x0e45cf9200c27af84ba175a8f6723ffd8dd8b083", "atomicFour": true, "creationBlock": 73100560, "deploymentTransaction": "0x625c3d03e7b396ab3167b85ddc2eb75cf65cf6549befd41e1c9773e709d42430", "runtimeSha256": "2df546ef4ef74033407294fe6ac0afeb0a1e3a662fe22ace4e398c964ba56c9b", "compiler": "0.8.28", "optimizer": {"enabled": true, "runs": 200}, "evmVersion": "cancun", "viaIR": false, "owner": "0x170249f9ac07d25f97bc1957b68a0011543d07ad", "oracle": "0xcd61a22acf76623114583a1e0a031c18201baf51", "platformRecipient": "0xcd61a22acf76623114583a1e0a031c18201baf51", "verifiedAt": "2026-11-20T00:20:58.622Z"}'::jsonb);
-- Per-deployment minimum blocks and the registered address allowlist replace the single-address guard.
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.music_chain_events'::regclass and contype='c' and (pg_get_constraintdef(oid) like '%0x0e45cf9200c27af84ba175a8f6723ffd8dd8b083%' or pg_get_constraintdef(oid) like '%73100560%') loop execute format('alter table public.music_chain_events drop constraint %I',c.conname); end loop;
end $$;
alter table public.music_chain_events add check(contract_address ~ '^0x[0-9a-f]{40}$');
alter table public.music_chain_events add check(block_number>=0);
create or replace function public.music_ingest_chain_events(p_nonce text, p_hash text, p_metadata jsonb, p_events jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare previous_hash text; item jsonb; old public.music_chain_events; target text; first_block numeric;
  inserted integer := 0; changed integer;
begin
  if p_nonce is null or length(p_nonce) not between 1 and 256 or
     p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or
     p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or
     p_events is null or jsonb_typeof(p_events) <> 'array' then raise exception 'BAD_DELIVERY'; end if;
  if jsonb_array_length(p_events) > 2000 then raise exception 'BAD_DELIVERY'; end if;
  -- Serialize overlapping live deliveries, retries, and historical backfills.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('music-events-ingest', 0));
  select payload_hash into previous_hash from public.music_event_deliveries where nonce = p_nonce;
  if found then
    if previous_hash <> p_hash then raise exception 'DELIVERY_CONFLICT'; end if;
    return jsonb_build_object('duplicate', true, 'inserted', 0);
  end if;
  for item in select value from jsonb_array_elements(p_events) loop
    target:=coalesce(item->>'contract_address','0x0e45cf9200c27af84ba175a8f6723ffd8dd8b083');
    select creation_block into first_block from public.music_deployments where contract_address=target and chain_id=5042002;
    if first_block is null or (item->>'block_number')::numeric<first_block then raise exception 'UNKNOWN_DEPLOYMENT'; end if;
    select * into old from public.music_chain_events
      where contract_address=target and chain_id=5042002 and transaction_hash = item->>'transaction_hash' and log_index = (item->>'log_index')::integer;
    if found and (
      old.block_hash is distinct from item->>'block_hash' or
      old.block_number is distinct from (item->>'block_number')::numeric or
      old.event_name is distinct from item->>'event_name' or
      old.args is distinct from item->'args' or
      (old.raw_log->'topics') is distinct from (item->'raw_log'->'topics') or
      lower(old.raw_log->>'data') is distinct from lower(item->'raw_log'->>'data')
    ) then raise exception 'EVENT_CONFLICT_RECONCILIATION_REQUIRED'; end if;
    insert into public.music_chain_events(contract_address,block_number, block_hash, transaction_hash, log_index, event_name, args, raw_log)
      values (target,(item->>'block_number')::numeric, item->>'block_hash', item->>'transaction_hash',
        (item->>'log_index')::integer, item->>'event_name', item->'args', item->'raw_log')
      on conflict do nothing;
    get diagnostics changed = row_count;
    inserted := inserted + changed;
  end loop;
  insert into public.music_event_deliveries(nonce, payload_hash, metadata, event_count)
    values (p_nonce, p_hash, p_metadata, jsonb_array_length(p_events));
  return jsonb_build_object('duplicate', false, 'inserted', inserted);
end $$;

create function public.music_register_market_deployment(p_id text,p_address text,p_block numeric,p_hash text,p_manifest jsonb,p_activate boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.music_deployments;
begin
 perform pg_advisory_xact_lock(hashtextextended('music-deployment-activation',0));
 if p_id is null or p_id='atomic-v1' or p_activate is null or jsonb_typeof(p_manifest) is distinct from 'object' or p_manifest->>'address' is distinct from p_address or p_manifest->>'marketModelVersion' is distinct from '2' or p_manifest->>'chainId' is distinct from '5042002' or (p_manifest->>'creationBlock')::numeric is distinct from p_block or p_manifest->>'runtimeSha256' is distinct from p_hash then raise exception 'BAD_DEPLOYMENT'; end if;
 select * into d from public.music_deployments where deployment_id=p_id;
 if d.deployment_id is not null and (d.contract_address<>p_address or d.creation_block<>p_block or d.runtime_sha256<>p_hash or d.model_version<>2) then raise exception 'DEPLOYMENT_IMMUTABLE'; end if;
 insert into public.music_deployments(deployment_id,chain_id,contract_address,model_version,creation_block,runtime_sha256,manifest)
 values(p_id,5042002,p_address,2,p_block,p_hash,p_manifest) on conflict do nothing;
 if not exists(select 1 from public.music_deployments where deployment_id=p_id and contract_address=p_address) then raise exception 'DEPLOYMENT_IMMUTABLE'; end if;
 if p_activate then
  update public.music_purchase_orders set state='expired',updated_at=now() where raw_transaction is null and state='awaiting_signature' and expires_at<=now();
  if exists(select 1 from public.music_purchase_orders where contract_address<>p_address and state in ('awaiting_signature','prepared','submitted','uncertain')) or exists(select 1 from public.music_admin_transactions where contract_address<>p_address and state not in ('confirmed','reverted','cancelled')) then raise exception 'OLD_DEPLOYMENT_PENDING'; end if;
  update public.music_deployments set active=false where active;
  update public.music_deployments set active=true where deployment_id=p_id;
 end if;
 select * into d from public.music_deployments where deployment_id=p_id;return to_jsonb(d);
end $$;
create function public.music_market_catalog(p_contract text,p_block numeric)
returns jsonb language sql stable security invoker set search_path='' as $$
 select public.music_live_catalog(p_contract,p_block)||jsonb_build_object('rounds',coalesce((select jsonb_agg(jsonb_build_object(
 'id',args->>'roundId','songId',args->>'songId','musicId',args->>'musicId','artist',lower(args->>'artist'),'startSeconds',args->>'start','deadlineSeconds',args->>'deadline','cadence',case when args->>'cadence'='0' then 'hourly' else 'daily' end) order by (args->>'start')::numeric, (args->>'roundId')::numeric)
 from public.music_chain_events where contract_address=p_contract and chain_id=5042002 and block_number<=p_block and event_name='RoundCreated'),'[]'::jsonb));
$$;
create function public.music_market_schedule(p_contract text,p_round text,p_type integer,p_block numeric)
returns jsonb language sql stable security invoker set search_path='' as $$
 select args from public.music_chain_events where contract_address=p_contract and chain_id=5042002 and block_number<=p_block and event_name='MarketScheduled' and args->>'roundId'=p_round and (args->>'marketType')::integer=p_type order by block_number,log_index limit 1;
$$;
alter table public.music_admin_transactions drop constraint music_admin_transactions_kind_check;
alter table public.music_admin_transactions add check(kind in ('approve','revoke','accept-owner','return-owner','create-round','submit-order','advance-settlement','restart-order','cancel-pool','create-hourly','create-daily'));
-- The existing operator function keeps its fenced nonce and duplicate-job behavior.
create or replace function public.music_v2_operator_job(p_kind text,p_wallet text,p_signer text,p_contract text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.music_account_approvals; t public.music_admin_transactions;
begin
  if p_kind not in ('revoke','reenable','accept-owner','return-owner','create-round','submit-order','advance-settlement','restart-order','cancel-pool','create-hourly','create-daily') then raise exception 'BAD_REQUEST'; end if;
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
create function public.music_market_schema_status() returns integer language sql stable security invoker set search_path='' as $$ select 2 $$;
revoke all on function public.music_register_market_deployment(text,text,numeric,text,jsonb,boolean),public.music_market_catalog(text,numeric),public.music_market_schedule(text,text,integer,numeric),public.music_market_schema_status() from public,anon,authenticated;
grant execute on function public.music_register_market_deployment(text,text,numeric,text,jsonb,boolean),public.music_market_catalog(text,numeric),public.music_market_schedule(text,text,integer,numeric),public.music_market_schema_status() to service_role;
create or replace function public.music_wallet_action_create(p_user text,p_wallet text,p_contract text,p_key uuid,p_request jsonb,p_tx jsonb,p_expires timestamptz,p_round jsonb,p_kind text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.music_purchase_orders;
begin
 if p_kind not in ('purchase','claim_entry') then raise exception 'BAD_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended('music-deployment-activation',0));
 perform pg_advisory_xact_lock(hashtextextended('music-purchase:'||p_wallet,0));
 update public.music_purchase_orders set state='expired',updated_at=now() where wallet_address=p_wallet and state='awaiting_signature' and expires_at<=now();
 select * into o from public.music_purchase_orders where privy_user_id=p_user and idempotency_key=p_key;
 if o.id is not null then
   if o.wallet_address<>p_wallet or o.contract_address<>p_contract or o.request<>p_request or o.action_kind<>p_kind then raise exception 'ORDER_CONFLICT'; end if;
   return to_jsonb(o);
 end if;
 if p_kind='purchase' and not exists(select 1 from public.music_deployments where contract_address=p_contract and active) then raise exception 'MARKET_CHANGED'; end if;
 if exists(select 1 from public.music_purchase_orders where wallet_address=p_wallet and state in ('awaiting_signature','prepared','submitted','uncertain')) then raise exception 'ORDER_PENDING'; end if;
 if exists(select 1 from public.music_purchase_orders where wallet_address=p_wallet and raw_transaction is not null and nonce>=(p_tx->>'nonce')::bigint) then raise exception 'ORDER_PENDING'; end if;
 insert into public.music_purchase_orders(privy_user_id,wallet_address,contract_address,idempotency_key,request,transaction,nonce,expires_at,round,action_kind)
 values(p_user,p_wallet,p_contract,p_key,p_request,p_tx,(p_tx->>'nonce')::bigint,p_expires,p_round,p_kind) returning * into o;
 return to_jsonb(o);
end $$;

commit;
