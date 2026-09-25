-- Dev seed. Runs after migrations on `supabase db reset`. NEVER run against prod.
--   * categories (5 rows, lv/ru/en)
--   * 40 fake listings across categories; photos from picsum so the app renders without SS.com
--   * today's daily_sets row + context_prices, built like build-daily (2 flats, 1 house, 1 car, 1 random)
--   * local round-token secret (vault + GUC fallback)

begin;

-- ─── local secrets ───────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'round_token_secret') then
    perform vault.create_secret('dev-secret-not-for-prod', 'round_token_secret', 'HMAC key for round tokens (dev)');
  end if;
exception when others then
  raise notice 'vault unavailable (%), relying on app.settings.token_secret', sqlerrm;
end $$;

do $$
begin
  execute format('alter database %I set app.settings.token_secret = %L', current_database(), 'dev-secret-not-for-prod');
exception when others then
  raise notice 'could not set app.settings.token_secret: %', sqlerrm;
end $$;

-- ─── categories ──────────────────────────────────────────────────────────────
insert into public.categories (key, labels, min_eur, max_eur, steps) values
  ('flats',  '{"lv":"Dzīvokļi","ru":"Квартиры","en":"Flats"}',            15000, 1500000, '{1000,5000,10000}'),
  ('houses', '{"lv":"Mājas","ru":"Дома","en":"Houses"}',                  20000, 3000000, '{5000,10000,50000}'),
  ('cars',   '{"lv":"Auto","ru":"Авто","en":"Cars"}',                       300,  250000, '{100,500,1000}'),
  ('random', '{"lv":"Visādas lietas","ru":"Всякое","en":"Random stuff"}',    5,   20000, '{5,20,100}'),
  ('land',   '{"lv":"Zeme","ru":"Земля","en":"Land"}',                     1000, 2000000, '{1000,5000,10000}')
on conflict (key) do update set labels = excluded.labels, min_eur = excluded.min_eur, max_eur = excluded.max_eur, steps = excluded.steps;

-- ─── listings ────────────────────────────────────────────────────────────────
-- ids fixed so the daily pick and any dev fixtures are stable
insert into public.listings (id, source, source_url, category, price_eur, region, location, attributes, title_hint, photo_urls, status, quality, first_seen_at, checked_at)
select v.id, 'ss', 'https://www.ss.com/msg/lv/seed/' || v.id || '.html', v.category, v.price_eur, v.region, v.location,
       v.attributes::jsonb, v.title_hint,
       array['https://picsum.photos/seed/' || v.id || 'a/800/600',
             'https://picsum.photos/seed/' || v.id || 'b/800/600',
             'https://picsum.photos/seed/' || v.id || 'c/800/600'],
       'active', v.quality, now() - interval '3 days', now()
from (values
  -- flats (Riga)
  (1,  'flats', 55000,  'riga', 'Purvciems',      '{"district":"purvciems","rooms":2,"m2":48,"floor":5,"floors_total":9,"series":"602.","elevator":true}', null, 0),
  (2,  'flats', 42000,  'riga', 'Pļavnieki',      '{"district":"plyavnieki","rooms":1,"m2":36,"floor":3,"floors_total":9,"series":"602."}', null, 0),
  (3,  'flats', 189000, 'riga', 'Centrs',         '{"district":"centre","rooms":3,"m2":92,"floor":4,"floors_total":6,"series":"P. kara","elevator":false}', 'Renovēts, jūgendstils', 1),
  (4,  'flats', 74500,  'riga', 'Teika',          '{"district":"teika","rooms":2,"m2":51,"floor":2,"floors_total":5,"series":"Hrušč."}', null, 0),
  (5,  'flats', 128000, 'riga', 'Āgenskalns',     '{"district":"agenskalns","rooms":3,"m2":78,"floor":1,"floors_total":3,"series":"P. kara"}', null, 0),
  (6,  'flats', 61000,  'riga', 'Ķengarags',      '{"district":"kengarags","rooms":3,"m2":62,"floor":7,"floors_total":9,"series":"602.","elevator":true}', null, 0),
  (7,  'flats', 345000, 'riga', 'Vecrīga',        '{"district":"vecriga","rooms":4,"m2":140,"floor":3,"floors_total":4,"series":"Renov."}', 'Skats uz Doma laukumu', 2),
  (8,  'flats', 38500,  'riga', 'Bolderāja',      '{"district":"bolderaya","rooms":2,"m2":44,"floor":4,"floors_total":5,"series":"Hrušč."}', null, 0),
  (9,  'flats', 97000,  'riga', 'Mežaparks',      '{"district":"mezhapark","rooms":2,"m2":58,"floor":2,"floors_total":3,"series":"Jaun."}', null, 0),
  (10, 'flats', 149000, 'riga', 'Ķīpsala',        '{"district":"kipsala","rooms":2,"m2":64,"floor":6,"floors_total":12,"series":"Jaun.","elevator":true}', null, 1),
  (11, 'flats', 52000,  'riga', 'Imanta',         '{"district":"imanta","rooms":2,"m2":50,"floor":9,"floors_total":9,"series":"119.","elevator":true}', null, 0),
  (12, 'flats', 67000,  'riga', 'Zolitūde',       '{"district":"zolitude","rooms":3,"m2":68,"floor":3,"floors_total":9,"series":"119.","elevator":true}', null, 0),
  (13, 'flats', 33000,  'riga', 'Latgales priekšpilsēta (Maskačka)', '{"district":"maskavas-priekshpilseta","rooms":1,"m2":30,"floor":2,"floors_total":2,"series":"P. kara"}', null, 0),
  (14, 'flats', 82000,  'riga_region', 'Jūrmala', '{"town":"Jūrmala","rooms":2,"m2":54,"floor":2,"floors_total":5,"series":"Jaun."}', null, 0),
  -- houses
  (15, 'houses', 165000, 'riga_region', 'Mārupe',   '{"town":"Mārupe","m2":142,"land_m2":1200,"house_type":"māja","year":2008}', null, 0),
  (16, 'houses', 89000,  'riga_region', 'Ogre',     '{"town":"Ogre","m2":110,"land_m2":900,"house_type":"māja","year":1985}', null, 0),
  (17, 'houses', 420000, 'riga',        'Mežaparks','{"district":"mezhapark","m2":260,"land_m2":1500,"house_type":"māja","year":2015}', null, 1),
  (18, 'houses', 47000,  'latvia',      'Jēkabpils','{"town":"Jēkabpils","m2":95,"land_m2":1400,"house_type":"māja","year":1972}', null, 0),
  (19, 'houses', 235000, 'riga_region', 'Babīte',   '{"town":"Babīte","m2":180,"land_m2":2000,"house_type":"māja","year":2012}', null, 0),
  (20, 'houses', 29000,  'latvia',      'Alūksne',  '{"town":"Alūksne","m2":80,"land_m2":2500,"house_type":"lauku māja","year":1960}', 'Lauku māja pie ezera', 0),
  (21, 'houses', 132000, 'riga_region', 'Salaspils','{"town":"Salaspils","m2":125,"land_m2":800,"house_type":"rindu māja","year":2006}', null, 0),
  (22, 'houses', 690000, 'riga_region', 'Jūrmala',  '{"town":"Jūrmala","m2":320,"land_m2":2400,"house_type":"māja","year":2019}', null, 1),
  -- cars
  (23, 'cars', 3500,  'riga', 'Rīga', '{"make":"Volkswagen","model":"Golf","year":2008,"engine_l":1.9,"fuel":"diesel","gearbox":"manual","km":268000,"body":"hečbeks"}', null, 0),
  (24, 'cars', 12900, 'riga', 'Rīga', '{"make":"BMW","model":"3 sērija","year":2014,"engine_l":2.0,"fuel":"diesel","gearbox":"auto","km":189000,"body":"sedans"}', null, 0),
  (25, 'cars', 27500, 'riga', 'Rīga', '{"make":"Toyota","model":"RAV4","year":2020,"engine_l":2.5,"fuel":"hybrid","gearbox":"auto","km":61000,"body":"apvidus"}', null, 0),
  (26, 'cars', 1200,  'latvia', 'Daugavpils', '{"make":"Opel","model":"Astra","year":2002,"engine_l":1.6,"fuel":"petrol","gearbox":"manual","km":312000,"body":"universāls"}', null, 0),
  (27, 'cars', 8900,  'riga', 'Rīga', '{"make":"Audi","model":"A4","year":2011,"engine_l":2.0,"fuel":"diesel","gearbox":"manual","km":233000,"body":"universāls"}', null, 0),
  (28, 'cars', 45000, 'riga', 'Rīga', '{"make":"Mercedes-Benz","model":"E klase","year":2021,"engine_l":2.0,"fuel":"diesel","gearbox":"auto","km":48000,"body":"sedans"}', null, 0),
  (29, 'cars', 650,   'latvia', 'Liepāja', '{"make":"VAZ (Lada)","model":"2107","year":1996,"engine_l":1.5,"fuel":"petrol","gearbox":"manual","km":98000,"body":"sedans"}', null, 1),
  (30, 'cars', 18700, 'riga_region', 'Jelgava', '{"make":"Skoda","model":"Octavia","year":2018,"engine_l":1.6,"fuel":"diesel","gearbox":"auto","km":142000,"body":"universāls"}', null, 0),
  (31, 'cars', 5400,  'riga', 'Rīga', '{"make":"Honda","model":"Civic","year":2007,"engine_l":1.8,"fuel":"petrol","gearbox":"manual","km":201000,"body":"hečbeks"}', null, 0),
  (32, 'cars', 33900, 'riga', 'Rīga', '{"make":"Tesla","model":"Model 3","year":2020,"fuel":"electric","gearbox":"auto","km":74000,"body":"sedans"}', null, 0),
  (33, 'cars', 2100,  'latvia', 'Valmiera', '{"make":"Renault","model":"Megane","year":2005,"engine_l":1.5,"fuel":"diesel","gearbox":"manual","km":289000,"body":"universāls"}', null, 0),
  (34, 'cars', 76000, 'riga', 'Rīga', '{"make":"Porsche","model":"Cayenne","year":2019,"engine_l":3.0,"fuel":"petrol","gearbox":"auto","km":58000,"body":"apvidus"}', null, 0),
  -- random
  (35, 'random', 35,   'riga', 'Rīga', '{"subcategory":"furniture","condition":"lietots"}', 'IKEA Poäng krēsls', 0),
  (36, 'random', 890,  'riga', 'Rīga', '{"subcategory":"electronics","condition":"jauns","manufacturer":"Apple"}', 'iPhone 15 128GB', 0),
  (37, 'random', 250,  'riga_region', 'Sigulda', '{"subcategory":"sports","condition":"lietots"}', 'Kalnu velosipēds Cube 29"', 0),
  (38, 'random', 1450, 'riga', 'Rīga', '{"subcategory":"musical","condition":"lietots","manufacturer":"Yamaha"}', 'Digitālās klavieres Yamaha P-125', 1),
  -- land
  (39, 'land', 24000,  'riga_region', 'Ādaži', '{"town":"Ādaži","m2":1800}', null, 0),
  (40, 'land', 145000, 'riga_region', 'Jūrmala', '{"town":"Jūrmala","m2":1200}', 'Priežu mežs, 400 m līdz jūrai', 0)
) as v(id, category, price_eur, region, location, attributes, title_hint, quality)
on conflict (source_url) do nothing;

select setval('public.listings_id_seq', greatest((select max(id) from public.listings), 1000));

-- ─── today's daily set (same recipe as functions/build-daily) ───────────────
-- deterministic "seeded" pick: order by md5(day || id); 2 flats (different districts), 1 house, 1 car, 1 random
do $$
declare
  today   date := (now() at time zone 'Europe/Riga')::date;
  ids     bigint[];
  snap    jsonb;
begin
  if exists (select 1 from daily_sets where day = today) then return; end if;

  with f1 as (
    select l.* from listings l where l.category = 'flats' and l.status = 'active'
    order by md5(today::text || l.id) limit 1),
  f2 as (
    select l.* from listings l, f1 where l.category = 'flats' and l.status = 'active'
      and l.id <> f1.id and (l.attributes ->> 'district') is distinct from (f1.attributes ->> 'district')
    order by md5(today::text || l.id) limit 1),
  h as (select l.* from listings l where l.category = 'houses' and l.status = 'active' order by md5(today::text || l.id) limit 1),
  c as (select l.* from listings l where l.category = 'cars'   and l.status = 'active' order by md5(today::text || l.id) limit 1),
  r as (select l.* from listings l where l.category = 'random' and l.status = 'active' order by md5(today::text || l.id) limit 1),
  chosen as (
    select id from f1 union all select id from f2 union all select id from h
    union all select id from c union all select id from r)
  -- l is a real `listings` row here, which private.strip(listings) requires; the md5 order is the "shuffle"
  select array_agg(l.id order by md5('shuffle' || today::text || l.id)),
         jsonb_agg(private.strip(l) order by md5('shuffle' || today::text || l.id))
    into ids, snap
  from listings l where l.id in (select id from chosen);

  if coalesce(array_length(ids, 1), 0) < 5 then
    raise notice 'seed: not enough listings for a daily set';
    return;
  end if;

  insert into daily_sets (day, listing_ids, snapshot) values (today, ids, snap);
  insert into context_prices (context_type, context_id, listing_id, price_eur)
  select 'daily', today::text, l.id, l.price_eur from listings l where l.id = any(ids)
  on conflict do nothing;
end $$;

commit;
