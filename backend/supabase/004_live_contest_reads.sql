-- Run once after 003. Backend-only views; no changes to recorded events/orders.
begin;
create index music_events_kind_block on public.music_chain_events(chain_id,contract_address,event_name,block_number);
create index music_events_entry_pool on public.music_chain_events(contract_address,(args->>'pool'),block_number) where event_name='EntryRecorded';
create index music_events_entry_payer on public.music_chain_events(contract_address,lower(args->>'payer'),block_number) where event_name='EntryRecorded';

create view public.music_live_rounds with (security_invoker=true) as
select chain_id,contract_address,block_number,block_hash,transaction_hash,log_index,
  (args->>'roundId')::numeric as round_id,args->>'songId' as song_id,
  args->>'musicId' as music_id,lower(args->>'artist') as artist,
  (args->>'start')::numeric as start_seconds
from public.music_chain_events where event_name='RoundCreated';

create view public.music_live_entries with (security_invoker=true) as
select chain_id,contract_address,block_number,block_hash,transaction_hash,log_index,
  (args->>'entryId')::numeric as entry_id,lower(args->>'pool') as pool,
  lower(args->>'payer') as payer,(args->>'guess')::numeric as guess,
  (args->>'paid')::numeric as paid,(args->>'spots')::integer as spots,
  (args->>'purchasedAt')::numeric as purchased_at
from public.music_chain_events where event_name='EntryRecorded';

create view public.music_live_claims with (security_invoker=true) as
select chain_id,contract_address,block_number,transaction_hash,log_index,
  (args->>'entryId')::numeric as entry_id,(args->>'amount')::numeric as amount,
  (args->>'refund')::boolean as refund
from public.music_chain_events where event_name='EntryClaimed';

revoke all on public.music_live_rounds,public.music_live_entries,public.music_live_claims from public,anon,authenticated;
grant select on public.music_live_rounds,public.music_live_entries,public.music_live_claims to service_role;

create function public.music_live_catalog(p_contract text,p_block numeric)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'roundCount',(select count(*)::text from public.music_live_rounds where chain_id=5042002 and contract_address=p_contract and block_number<=p_block),
  'maxRoundId',(select coalesce(max(round_id),0)::text from public.music_live_rounds where chain_id=5042002 and contract_address=p_contract and block_number<=p_block),
  'entryCount',(select count(*)::text from public.music_live_entries where chain_id=5042002 and contract_address=p_contract and block_number<=p_block),
  'rounds',coalesce((select jsonb_agg(jsonb_build_object('id',round_id::text,'songId',song_id,'musicId',music_id,'artist',artist,'startSeconds',start_seconds::text) order by start_seconds,round_id)
    from public.music_live_rounds where chain_id=5042002 and contract_address=p_contract and block_number<=p_block),'[]'::jsonb)
 );
$$;

create function public.music_live_round(p_contract text,p_block numeric,p_pools jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
 with pools as (select key as horizon,value as pool from jsonb_each_text(p_pools)),
 entries as (select e.* from public.music_live_entries e join pools p on e.pool=p.pool where e.chain_id=5042002 and e.contract_address=p_contract and e.block_number<=p_block),
 guesses as (select pool,guess,sum(spots) as weight,row_number() over(partition by pool order by sum(spots) desc,guess asc) as rank from entries group by pool,guess)
 select coalesce(jsonb_object_agg(p.horizon,jsonb_build_object(
  'pool',p.pool,'entryCount',(select count(*)::text from entries e where e.pool=p.pool),
  'spotCount',(select coalesce(sum(spots),0)::text from entries e where e.pool=p.pool),
  'peopleCount',(select count(distinct payer)::text from entries e where e.pool=p.pool),
  'totalDeposits',(select coalesce(sum(paid),0)::text from entries e where e.pool=p.pool),
  -- div() keeps the rounding exact even for 78-digit guesses. Numeric division
  -- can otherwise choose a result scale of zero for a very large quotient.
  'averageGuess',(select div(a.cents,100)::text||'.'||lpad(mod(a.cents,100)::text,2,'0')
    from (select div(sum(guess*spots)*200+sum(spots),nullif(sum(spots)*2,0)) as cents from entries e where e.pool=p.pool) a where a.cents is not null),
  'mode',(select guess::text from guesses g where g.pool=p.pool and rank=1),
  'modeSpots',coalesce((select weight::text from guesses g where g.pool=p.pool and rank=1),'0')
 )),'{}'::jsonb) from pools p;
$$;

create function public.music_live_account_entries(p_contract text,p_wallet text,p_block numeric,p_cursor jsonb default null,p_limit integer default 10)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_limit<1 or p_limit>10 or p_wallet !~ '^0x[0-9a-f]{40}$' then raise exception 'BAD_REQUEST'; end if;
 with mine as (select * from public.music_live_entries where chain_id=5042002 and contract_address=p_contract and payer=p_wallet and block_number<=p_block),
 grouped as (
   select transaction_hash,block_number,min(purchased_at) as purchased_at,
    jsonb_agg(jsonb_build_object('entryId',entry_id::text,'pool',pool,'guess',guess::text,'paid',paid::text,'spots',spots::text,'purchasedAt',purchased_at::text,'blockHash',block_hash,'logIndex',log_index) order by entry_id) as entries
   from mine group by transaction_hash,block_number
 ), page as (
   select * from grouped where p_cursor is null or (block_number,transaction_hash)<((p_cursor->>'block')::numeric,p_cursor->>'hash')
   order by block_number desc,transaction_hash desc limit p_limit+1
 )
 select jsonb_build_object(
   'groups',coalesce((select jsonb_agg(jsonb_build_object('transactionHash',transaction_hash,'block',block_number::text,'purchasedAt',purchased_at::text,'entries',entries) order by block_number desc,transaction_hash desc) from page),'[]'::jsonb),
   'totalGroups',(select count(*)::text from grouped)
 ) into result;
 return result;
end $$;

revoke all on function public.music_live_catalog(text,numeric),public.music_live_round(text,numeric,jsonb),public.music_live_account_entries(text,text,numeric,jsonb,integer) from public,anon,authenticated;
grant execute on function public.music_live_catalog(text,numeric),public.music_live_round(text,numeric,jsonb),public.music_live_account_entries(text,text,numeric,jsonb,integer) to service_role;
commit;
