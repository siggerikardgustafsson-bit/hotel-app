-- ============================================================
-- 002_ical_cron.sql
-- Schemalägger den nattliga iCal-fallbacken (Edge Function
-- "ical-sync") via pg_cron + pg_net.
--
-- VIKTIGT — BYT UT INNAN DU KÖR:
--   <PROJECT_REF>          -> ditt Supabase project ref (finns i
--                            Dashboard-URL:en: app.supabase.com/project/<PROJECT_REF>,
--                            eller under Project Settings → General → Reference ID)
--   <SERVICE_ROLE_KEY>     -> Project Settings → API → service_role key
--
-- VAR DU KÖR DEN:
--   Supabase Dashboard → SQL Editor → klistra in → Run
--
-- Kör detta EFTER att du deployat edge-funktionen ical-sync
-- (annars finns ingen URL att anropa).
-- ============================================================

-- 1) Aktivera de extensions som behövs.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2) Ta bort ev. tidigare schemalagt jobb med samma namn (idempotent).
select cron.unschedule('nightly-ical-sync')
  where exists (select 1 from cron.job where jobname = 'nightly-ical-sync');

-- 3) Schemalägg nattligt anrop kl 03:00 (server-tid, UTC).
--    pg_net gör en HTTP POST till edge-funktionen, som i sin tur
--    hämtar iCal-feeden och upsertar mot bookings.
select cron.schedule(
  'nightly-ical-sync',
  '0 3 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/ical-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Kontroll: se schemalagda jobb
--   select * from cron.job;
-- Kontroll: se senaste körningar
--   select * from cron.job_run_details order by start_time desc limit 10;
