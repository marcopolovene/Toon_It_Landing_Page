-- Ops dashboard aggregate style counts for trailing 7 days.
-- Purpose: expose aggregate-only style totals to the public ops dashboard without relying on raw generations RLS.
create or replace view public.ops_style_counts_7d as
select
  coalesce(nullif(style, ''), 'unknown')::text as style,
  count(*)::integer as transformations_total,
  count(*) filter (where status = 'complete')::integer as transformations_complete,
  count(*) filter (where status = 'failed')::integer as transformations_failed,
  min(created_at) as first_seen_at,
  max(created_at) as last_seen_at
from public.generations
where created_at >= (now() - interval '7 days')
group by 1
order by transformations_total desc, style asc;

grant select on public.ops_style_counts_7d to anon, authenticated;
comment on view public.ops_style_counts_7d is 'Aggregate-only ops dashboard style counts for the trailing 7 days. Exposes counts only; avoids raw generations RLS undercount.';
notify pgrst, 'reload schema';
