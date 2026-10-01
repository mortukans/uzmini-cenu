-- 24 pick_listings: never serve a round without a live photo.
-- SS.com removes an ad's photos before the ad itself; i.ss.com then answers
-- 200 with a 1×1 GIF, so a listing can be `active` with a photo_urls array that
-- renders blank. The scraper now expires such rows with
-- attributes.reject_reason = 'photo_dead' (status filter already excludes them);
-- this makes the pick itself defensive as well: at least one photo URL, and
-- never a row flagged photo_dead whatever its status.

create or replace function private.pick_listings(p_category text, p_region text, p_n int,
                                                  p_exclude bigint[] default '{}')
returns setof public.listings language sql stable security definer set search_path = public as $$
  -- random() over the fresh index range is fine at 50k rows
  select * from listings l
  where l.status = 'active'
    and l.checked_at > now() - interval '72 hours'
    and (p_category is null or p_category = 'all' or l.category = p_category)
    and (p_region is null or p_region = 'latvia' or l.region = p_region)
    and not (l.id = any(coalesce(p_exclude, '{}')))
    and l.quality >= 0
    and coalesce(array_length(l.photo_urls, 1), 0) >= 1
    and coalesce(l.attributes ->> 'reject_reason', '') <> 'photo_dead'
  order by random()
  limit p_n
$$;

revoke all on function private.pick_listings(text, text, int, bigint[]) from public;
