-- Ops dashboard filtered anonymous-generation aggregate.
-- Keeps the Anon Gens card aligned with the existing include_test_data toggle.

create or replace view public.ops_anonymous_generations_filtered as
with modes as (
  select false as include_test_data
  union all select true as include_test_data
), generation_flags as (
  select
    g.id,
    g.job_id,
    g.user_id,
    g.created_at,
    g.status,
    coalesce(ptf.is_test_user, false)
      or g.job_id in (
        -- Agent Zero / ops verification webhook jobs from the 2026-06-04 n8n hotfix window.
        -- These are anonymous by DB shape (user_id null), but are not customer anon traffic.
        'job_1780600470553_1e0oc7xux',
        'job_1780600521913_g6gkwv2tf',
        'job_1780603602528_f8akbq48j',
        'job_1780616384640_11tp9qrt8',
        'job_1780616509705_el0ubrzno'
      ) as is_test_generation
  from public.generations g
  left join public.ops_profiles_test_flags ptf on ptf.id = g.user_id
)
select
  m.include_test_data,
  count(g.id) filter (where g.user_id is null and g.created_at >= (now() - interval '24 hours'))::integer as anon_24h,
  count(g.id) filter (where g.user_id is null)::integer as anon_total,
  count(g.id) filter (where g.user_id is null and g.created_at >= (now() - interval '24 hours') and g.status = 'complete')::integer as anon_24h_complete,
  count(g.id) filter (where g.user_id is null and g.created_at >= (now() - interval '24 hours') and g.status = 'failed')::integer as anon_24h_failed,
  count(g.id) filter (where g.user_id is null and g.is_test_generation and g.created_at >= (now() - interval '7 days'))::integer as test_anon_generations_7d
from modes m
left join generation_flags g on (m.include_test_data or not g.is_test_generation)
group by m.include_test_data
order by m.include_test_data;

grant select on public.ops_anonymous_generations_filtered to anon, authenticated;
comment on view public.ops_anonymous_generations_filtered is 'Ops dashboard anonymous generation metrics with include_test_data false/true variants; excludes known internal/test generations by default.';
notify pgrst, 'reload schema';
