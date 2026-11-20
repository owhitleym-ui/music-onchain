-- Apply after 007. Private source observations and immutable per-round rules.
begin;
create table public.music_song_metadata(song_id text primary key,document jsonb not null,raw_response text not null,response_hash text not null check(response_hash~'^[0-9a-f]{64}$'),fetched_at timestamptz not null);
create table public.music_data_state(song_id text primary key,worker uuid,lease_until timestamptz,last_attempt timestamptz,last_success timestamptz,next_attempt timestamptz,error_code text);
create table public.music_data_collections(id uuid primary key default gen_random_uuid(),song_id text not null,start_date date not null,end_date date not null,fetched_at timestamptz not null,raw_response text not null,response_hash text not null check(response_hash~'^[0-9a-f]{64}$'),document jsonb not null,unique(song_id,fetched_at));
create table public.music_daily_observations(collection_id uuid references public.music_data_collections(id),song_id text not null,report_date date not null,views numeric(78,0) check(views>=0),metrics jsonb not null,observed_at timestamptz not null,response_hash text not null,primary key(collection_id,report_date));
create index music_daily_source_history on public.music_daily_observations(song_id,report_date,observed_at desc);
create table public.music_round_rules(contract_address text not null,round_id text not null,market_type text not null check(market_type in ('day_plus_1','day_plus_2','day_plus_7')),policy jsonb not null,created_at timestamptz not null default now(),primary key(contract_address,round_id,market_type));
alter table public.music_song_metadata enable row level security;
alter table public.music_data_state enable row level security;
alter table public.music_data_collections enable row level security;
alter table public.music_daily_observations enable row level security;
alter table public.music_round_rules enable row level security;
revoke all on public.music_song_metadata,public.music_data_state,public.music_data_collections,public.music_daily_observations,public.music_round_rules from public,anon,authenticated;
grant select,insert,update on public.music_song_metadata to service_role;
grant select on public.music_data_state,public.music_data_collections,public.music_daily_observations,public.music_round_rules to service_role;
create function public.music_data_claim(p_song text,p_worker uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare s public.music_data_state;
begin
 if p_song<>'tennessee-orange' or p_worker is null then raise exception 'BAD_REQUEST';end if;
 insert into public.music_data_state(song_id) values(p_song) on conflict do nothing;
 select * into s from public.music_data_state where song_id=p_song for update;
 if s.next_attempt>now() or s.lease_until>now() then return false;end if;
 update public.music_data_state set worker=p_worker,lease_until=now()+interval '2 minutes',last_attempt=now(),next_attempt=now()+interval '1 hour' where song_id=p_song;
 return true;
end $$;
create function public.music_data_finish(p_song text,p_worker uuid,p_result jsonb,p_error text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare s public.music_data_state; c uuid; r jsonb;
begin
 select * into s from public.music_data_state where song_id=p_song for update;
 if s.worker is distinct from p_worker or s.lease_until<now() then raise exception 'LEASE_LOST';end if;
 if p_error is not null then
  update public.music_data_state set worker=null,lease_until=null,error_code=p_error,next_attempt=now()+interval '1 hour' where song_id=p_song;return false;
 end if;
 if p_result is null or jsonb_typeof(p_result->'rows')<>'array' or jsonb_array_length(p_result->'rows')>31 then raise exception 'BAD_DATA';end if;
 insert into public.music_data_collections(song_id,start_date,end_date,fetched_at,raw_response,response_hash,document)
 values(p_song,(p_result->>'start')::date,(p_result->>'end')::date,(p_result->>'fetchedAt')::timestamptz,p_result->>'raw',p_result->>'hash',p_result->'body') returning id into c;
 for r in select value from jsonb_array_elements(p_result->'rows') loop
  insert into public.music_daily_observations(collection_id,song_id,report_date,views,metrics,observed_at,response_hash)
  values(c,p_song,(r->>'date')::date,(r->>'views')::numeric,r->'metrics',(p_result->>'fetchedAt')::timestamptz,p_result->>'hash');
 end loop;
 update public.music_data_state set worker=null,lease_until=null,last_success=(p_result->>'fetchedAt')::timestamptz,next_attempt=now()+interval '6 hours',error_code=null where song_id=p_song;
 return true;
end $$;
create function public.music_bind_result_policy(p_contract text,p_round text,p_type text,p_policy jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare previous jsonb;
begin
 if p_contract!~'^0x[0-9a-f]{40}$' or p_round!~'^[1-9][0-9]*$' or p_policy->>'source'<>'chartex' or p_policy->>'songId'<>'tennessee-orange' then raise exception 'BAD_POLICY';end if;
 insert into public.music_round_rules(contract_address,round_id,market_type,policy) values(p_contract,p_round,p_type,p_policy) on conflict do nothing;
 select policy into previous from public.music_round_rules where contract_address=p_contract and round_id=p_round and market_type=p_type;
 if previous is distinct from p_policy then raise exception 'POLICY_IMMUTABLE';end if;return true;
end $$;

-- A pool's first valid candidate survives crashes before a transaction is queued.
create table public.music_result_candidates(contract_address text not null,round_id text not null,market_type text not null,evidence_hash text not null check(evidence_hash~'^0x[0-9a-f]{64}$'),document jsonb not null,created_at timestamptz not null default now(),primary key(contract_address,round_id,market_type),foreign key(contract_address,round_id,market_type) references public.music_round_rules);
alter table public.music_result_candidates enable row level security;
revoke all on public.music_result_candidates from public,anon,authenticated;
grant select on public.music_result_candidates to service_role;
create function public.music_freeze_result(p_contract text,p_round text,p_type text,p_hash text,p_document jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.music_result_candidates; rules jsonb;
begin
 select policy into rules from public.music_round_rules where contract_address=p_contract and round_id=p_round and market_type=p_type;
 if rules is null or p_document->'policy' is distinct from rules or p_document->>'source'<>'chartex' or p_document->>'contract'<>p_contract or p_document->>'roundId'<>p_round or p_document->>'horizon'<>p_type then raise exception 'BAD_EVIDENCE';end if;
 insert into public.music_result_candidates(contract_address,round_id,market_type,evidence_hash,document) values(p_contract,p_round,p_type,p_hash,p_document) on conflict do nothing;
 select * into r from public.music_result_candidates where contract_address=p_contract and round_id=p_round and market_type=p_type;
 return to_jsonb(r);
end $$;
revoke all on function public.music_freeze_result(text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.music_freeze_result(text,text,text,text,jsonb) to service_role;

-- Include result submission and oracle configuration in the same fenced nonce queue.
alter table public.music_admin_transactions drop constraint music_admin_transactions_kind_check;
alter table public.music_admin_transactions add constraint music_admin_transactions_kind_check check(kind in ('approve','revoke','accept-owner','return-owner','create-round','submit-order','advance-settlement','restart-order','cancel-pool','create-hourly','create-daily','submit-result','set-oracle'));
create or replace function public.music_v2_operator_job(p_kind text,p_wallet text,p_signer text,p_contract text,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare a public.music_account_approvals; t public.music_admin_transactions;
begin
  if p_kind not in ('revoke','reenable','accept-owner','return-owner','create-round','submit-order','advance-settlement','restart-order','cancel-pool','create-hourly','create-daily','submit-result','set-oracle') then raise exception 'BAD_REQUEST'; end if;
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
create function public.music_step7_status() returns integer language sql stable security invoker set search_path='' as $$select 1$$;
revoke all on function public.music_data_claim(text,uuid),public.music_data_finish(text,uuid,jsonb,text),public.music_bind_result_policy(text,text,text,jsonb),public.music_step7_status() from public,anon,authenticated;
grant execute on function public.music_data_claim(text,uuid),public.music_data_finish(text,uuid,jsonb,text),public.music_bind_result_policy(text,text,text,jsonb),public.music_step7_status() to service_role;
commit;
