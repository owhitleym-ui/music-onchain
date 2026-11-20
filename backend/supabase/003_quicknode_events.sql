-- Run ONCE in the music project's SQL editor. Adds isolated event storage only.
-- Does not change approvals, purchase orders, other tables, or contract state.
begin;

create table public.music_chain_events (
  chain_id integer not null default 5042002 check (chain_id = 5042002),
  contract_address text not null default '0x0e45cf9200c27af84ba175a8f6723ffd8dd8b083'
    check (contract_address = '0x0e45cf9200c27af84ba175a8f6723ffd8dd8b083'),
  block_number numeric(20,0) not null check (block_number >= 73100560),
  block_hash text not null check (block_hash ~ '^0x[0-9a-f]{64}$'),
  transaction_hash text not null check (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  log_index integer not null check (log_index >= 0),
  event_name text not null check (length(event_name) between 1 and 100),
  args jsonb not null check (jsonb_typeof(args) = 'object'),
  raw_log jsonb not null check (jsonb_typeof(raw_log) = 'object'),
  received_at timestamptz not null default now(),
  primary key (chain_id, contract_address, transaction_hash, log_index)
);
create index music_chain_events_block on public.music_chain_events(block_number, log_index);

create table public.music_event_deliveries (
  nonce text primary key check (length(nonce) between 1 and 256),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null check (jsonb_typeof(metadata) = 'object'),
  event_count integer not null check (event_count between 0 and 2000),
  received_at timestamptz not null default now()
);
alter table public.music_chain_events enable row level security;
alter table public.music_event_deliveries enable row level security;
revoke all on public.music_chain_events, public.music_event_deliveries from public, anon, authenticated;
grant select on public.music_chain_events, public.music_event_deliveries to service_role;

create function public.music_ingest_chain_events(p_nonce text, p_hash text, p_metadata jsonb, p_events jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare previous_hash text; item jsonb; old public.music_chain_events;
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
    select * into old from public.music_chain_events
      where transaction_hash = item->>'transaction_hash' and log_index = (item->>'log_index')::integer;
    if found and (
      old.block_hash is distinct from item->>'block_hash' or
      old.block_number is distinct from (item->>'block_number')::numeric or
      old.event_name is distinct from item->>'event_name' or
      old.args is distinct from item->'args' or
      (old.raw_log->'topics') is distinct from (item->'raw_log'->'topics') or
      lower(old.raw_log->>'data') is distinct from lower(item->'raw_log'->>'data')
    ) then raise exception 'EVENT_CONFLICT_RECONCILIATION_REQUIRED'; end if;
    insert into public.music_chain_events(block_number, block_hash, transaction_hash, log_index, event_name, args, raw_log)
      values ((item->>'block_number')::numeric, item->>'block_hash', item->>'transaction_hash',
        (item->>'log_index')::integer, item->>'event_name', item->'args', item->'raw_log')
      on conflict do nothing;
    get diagnostics changed = row_count;
    inserted := inserted + changed;
  end loop;
  insert into public.music_event_deliveries(nonce, payload_hash, metadata, event_count)
    values (p_nonce, p_hash, p_metadata, jsonb_array_length(p_events));
  return jsonb_build_object('duplicate', false, 'inserted', inserted);
end $$;
revoke all on function public.music_ingest_chain_events(text,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.music_ingest_chain_events(text,text,jsonb,jsonb) to service_role;
commit;
