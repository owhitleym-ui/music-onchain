-- Supabase / Postgres schema for the backend. Run once in the Supabase SQL editor.
-- Only the server (service-role key) touches these tables; keep RLS enabled with no policies
-- so the anon key can't read or write them.

-- Decoded Competition events delivered by the QuickNode Stream.
-- Primary key makes redelivery idempotent (Arc has deterministic finality, so no reorg handling).
create table if not exists chain_events (
  tx_hash        text        not null,
  log_index      int         not null,
  block_number   bigint      not null,
  block_time     timestamptz,
  event_name     text        not null,   -- EntrySubmitted, CompetitionSettled, WinnerPaid, ...
  competition_id bigint,
  args           jsonb       not null,   -- decoded args; bigints stored as decimal strings
  received_at    timestamptz not null default now(),
  primary key (tx_hash, log_index)
);
create index if not exists chain_events_competition_idx on chain_events (competition_id, event_name);
create index if not exists chain_events_player_idx on chain_events ((args->>'player'));
alter table chain_events enable row level security;

-- One faucet drip per Privy user and per wallet address.
create table if not exists faucet_drips (
  privy_user_id text        primary key,
  address       text        not null unique,
  amount        numeric     not null,       -- raw USDC units (6 decimals)
  tx_hash       text,                       -- null while the transfer is in flight
  created_at    timestamptz not null default now()
);
alter table faucet_drips enable row level security;
