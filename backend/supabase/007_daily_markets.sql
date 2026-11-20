-- Apply after 006. This migration adds daily V3 without rewriting existing events or deployments.
begin;
alter table public.music_deployments drop constraint music_deployments_model_version_check;
alter table public.music_deployments add constraint music_deployments_model_version_check check(model_version in (1,2,3));
create or replace function public.music_register_market_deployment(p_id text,p_address text,p_block numeric,p_hash text,p_manifest jsonb,p_activate boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.music_deployments; v integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('music-deployment-activation',0));
 v:=case when p_manifest->>'marketModelVersion' in ('2','3') then (p_manifest->>'marketModelVersion')::integer else null end;
 if v is null or (v=3 and p_id<>'markets-v3') or p_id is null or p_id='atomic-v1' or p_activate is null or jsonb_typeof(p_manifest) is distinct from 'object' or p_manifest->>'address' is distinct from p_address or p_manifest->>'chainId' is distinct from '5042002' or (p_manifest->>'creationBlock')::numeric is distinct from p_block or p_manifest->>'runtimeSha256' is distinct from p_hash then raise exception 'BAD_DEPLOYMENT'; end if;
 select * into d from public.music_deployments where deployment_id=p_id;
 if d.deployment_id is not null and (d.contract_address<>p_address or d.creation_block<>p_block or d.runtime_sha256<>p_hash or d.model_version<>v) then raise exception 'DEPLOYMENT_IMMUTABLE'; end if;
 insert into public.music_deployments(deployment_id,chain_id,contract_address,model_version,creation_block,runtime_sha256,manifest)
 values(p_id,5042002,p_address,v,p_block,p_hash,p_manifest) on conflict do nothing;
 if not exists(select 1 from public.music_deployments where deployment_id=p_id and contract_address=p_address) then raise exception 'DEPLOYMENT_IMMUTABLE'; end if;
 if p_activate then
  update public.music_purchase_orders set state='expired',updated_at=now() where raw_transaction is null and state='awaiting_signature' and expires_at<=now();
  if exists(select 1 from public.music_purchase_orders where contract_address<>p_address and state in ('awaiting_signature','prepared','submitted','uncertain')) or exists(select 1 from public.music_admin_transactions where contract_address<>p_address and state not in ('confirmed','reverted','cancelled')) then raise exception 'OLD_DEPLOYMENT_PENDING'; end if;
  update public.music_deployments set active=false where active;
  update public.music_deployments set active=true where deployment_id=p_id;
 end if;
 select * into d from public.music_deployments where deployment_id=p_id;return to_jsonb(d);
end $$;
create or replace function public.music_market_schema_status() returns integer language sql stable security invoker set search_path='' as $$ select 3 $$;
revoke all on function public.music_register_market_deployment(text,text,numeric,text,jsonb,boolean),public.music_market_schema_status() from public,anon,authenticated;
grant execute on function public.music_register_market_deployment(text,text,numeric,text,jsonb,boolean),public.music_market_schema_status() to service_role;
commit;
