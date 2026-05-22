-- Ops dashboard test/internal-user filter aggregates.
-- Default dashboard mode excludes known test/internal users; toggle can include them.

create or replace view public.ops_profiles_test_flags as
select
  p.id,
  p.created_at,
  case
    when lower(coalesce(p.email, '')) like '%loadtest%' then true
    when lower(coalesce(p.email, '')) like '%test%' then true
    when lower(coalesce(p.email, '')) like '%marco%' then true
    when lower(coalesce(p.email, '')) like '%marcopolo%' then true
    when lower(coalesce(p.email, '')) like '%marcopolovene%' then true
    when lower(coalesce(p.email, '')) like '%firedog%' then true
    when lower(coalesce(p.email, '')) like '%agentzero%' then true
    when lower(coalesce(p.email, '')) like '%agent-zero%' then true
    else false
  end as is_test_user
from public.profiles p;

create or replace view public.ops_generations_test_flags as
select
  g.id,
  g.user_id,
  g.created_at,
  g.status,
  g.style,
  coalesce(ptf.is_test_user, false) as is_test_user
from public.generations g
left join public.ops_profiles_test_flags ptf on ptf.id = g.user_id;

drop view if exists public.ops_dashboard_summary_filtered cascade;
create view public.ops_dashboard_summary_filtered as
with modes as (
  select false as include_test_data
  union all select true as include_test_data
), profile_stats as (
  select
    m.include_test_data,
    count(p.id)::integer as total_users,
    count(p.id) filter (where p.created_at >= (now() - interval '24 hours'))::integer as new_users_24h,
    count(p.id) filter (where p.is_test_user)::integer as test_users_total
  from modes m
  left join public.ops_profiles_test_flags p on (m.include_test_data or not p.is_test_user)
  group by m.include_test_data
), generation_stats as (
  select
    m.include_test_data,
    count(g.id) filter (where g.created_at >= (now() - interval '24 hours'))::integer as generations_24h_total,
    count(g.id) filter (where g.created_at >= (now() - interval '24 hours') and g.status = 'complete')::integer as generations_24h_complete,
    count(g.id) filter (where g.created_at >= (now() - interval '24 hours') and g.status = 'failed')::integer as generations_24h_failed,
    count(g.id) filter (where g.created_at >= (now() - interval '48 hours') and g.created_at < (now() - interval '24 hours'))::integer as generations_prev24h_total,
    count(g.id) filter (where g.created_at >= (now() - interval '48 hours') and g.created_at < (now() - interval '24 hours') and g.status = 'failed')::integer as generations_prev24h_failed,
    count(g.id) filter (where g.created_at >= (now() - interval '7 days') and g.is_test_user)::integer as test_generations_7d
  from modes m
  left join public.ops_generations_test_flags g on (m.include_test_data or not g.is_test_user)
  group by m.include_test_data
), feedback_stats as (
  select
    m.include_test_data,
    count(f.id) filter (where f.rating is not null)::integer as rating_count,
    round(avg(f.rating) filter (where f.rating is not null)::numeric, 1) as avg_rating
  from modes m
  left join public.feedback f on true
  left join public.ops_profiles_test_flags p on p.id = f.user_id
  where m.include_test_data or coalesce(p.is_test_user, false) = false
  group by m.include_test_data
)
select
  ps.include_test_data,
  ps.total_users,
  ps.new_users_24h,
  ps.test_users_total,
  gs.generations_24h_total,
  gs.generations_24h_complete,
  gs.generations_24h_failed,
  gs.generations_prev24h_total,
  gs.generations_prev24h_failed,
  gs.test_generations_7d,
  fs.rating_count,
  fs.avg_rating
from profile_stats ps
join generation_stats gs using (include_test_data)
join feedback_stats fs using (include_test_data)
order by ps.include_test_data;

drop view if exists public.ops_daily_metrics_filtered_7d cascade;
create view public.ops_daily_metrics_filtered_7d as
with modes as (
  select false as include_test_data
  union all select true as include_test_data
), days as (
  select generate_series((((now() at time zone 'America/New_York')::date - interval '6 days')::date), ((now() at time zone 'America/New_York')::date), interval '1 day')::date as date
)
select
  m.include_test_data,
  d.date,
  count(g.id) filter (where g.status = 'complete')::integer as transformations_success,
  count(g.id) filter (where g.status = 'failed')::integer as transformations_error,
  count(g.id) filter (where g.status = 'processing')::integer as transformations_processing,
  count(g.id)::integer as transformations_total,
  count(distinct g.user_id)::integer as active_users
from modes m
cross join days d
left join public.ops_generations_test_flags g
  on date(g.created_at at time zone 'America/New_York') = d.date
 and (m.include_test_data or not g.is_test_user)
group by m.include_test_data, d.date
order by d.date desc, m.include_test_data;

drop view if exists public.ops_daily_signups_filtered_7d cascade;
create view public.ops_daily_signups_filtered_7d as
with modes as (
  select false as include_test_data
  union all select true as include_test_data
), days as (
  select generate_series((((now() at time zone 'America/New_York')::date - interval '6 days')::date), ((now() at time zone 'America/New_York')::date), interval '1 day')::date as date
)
select
  m.include_test_data,
  d.date,
  count(p.id)::integer as new_signups
from modes m
cross join days d
left join public.ops_profiles_test_flags p
  on date(p.created_at at time zone 'America/New_York') = d.date
 and (m.include_test_data or not p.is_test_user)
group by m.include_test_data, d.date
order by d.date desc, m.include_test_data;

drop view if exists public.ops_style_counts_filtered_7d cascade;
create view public.ops_style_counts_filtered_7d as
with modes as (
  select false as include_test_data
  union all select true as include_test_data
)
select
  m.include_test_data,
  coalesce(nullif(g.style, ''), 'unknown')::text as style,
  count(g.id)::integer as transformations_total,
  count(g.id) filter (where g.status = 'complete')::integer as transformations_complete,
  count(g.id) filter (where g.status = 'failed')::integer as transformations_failed,
  min(g.created_at) as first_seen_at,
  max(g.created_at) as last_seen_at
from modes m
join public.ops_generations_test_flags g on (m.include_test_data or not g.is_test_user)
where g.created_at >= (now() - interval '7 days')
group by m.include_test_data, 2
order by m.include_test_data, transformations_total desc, style asc;

revoke all on public.ops_profiles_test_flags from anon, authenticated;
revoke all on public.ops_generations_test_flags from anon, authenticated;
grant select on public.ops_dashboard_summary_filtered to anon, authenticated;
grant select on public.ops_daily_metrics_filtered_7d to anon, authenticated;
grant select on public.ops_daily_signups_filtered_7d to anon, authenticated;
grant select on public.ops_style_counts_filtered_7d to anon, authenticated;

comment on view public.ops_profiles_test_flags is 'Ops internal helper: classifies known test/internal users without exposing emails in dashboard aggregates.';
comment on view public.ops_generations_test_flags is 'Ops internal helper: generation rows with test/internal-user flag for aggregate dashboard views.';
comment on view public.ops_dashboard_summary_filtered is 'Ops dashboard summary metrics with include_test_data false/true variants.';
comment on view public.ops_daily_metrics_filtered_7d is 'Ops dashboard daily generation metrics with include_test_data false/true variants.';
comment on view public.ops_daily_signups_filtered_7d is 'Ops dashboard daily signup metrics with include_test_data false/true variants.';
comment on view public.ops_style_counts_filtered_7d is 'Aggregate-only ops dashboard style counts for the trailing 7 days with include_test_data false/true variants.';
notify pgrst, 'reload schema';
