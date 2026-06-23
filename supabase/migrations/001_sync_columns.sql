-- ============================================================
-- 001_sync_columns.sql
-- Lägger till kolumner och index som behövs för automatisk
-- bokningssynk (mejlparser + iCal-fallback) samt aktiverar
-- Supabase Realtime på bookings.
--
-- VAR DU KÖR DEN:
--   Supabase Dashboard → SQL Editor → klistra in → Run
--   (eller: supabase db push om du länkat projektet via CLI)
--
-- Säker att köra om (idempotent).
-- ============================================================

-- 1) source: var kom raden ifrån? 'manual' | 'xls' | 'email' | 'ical'
--    Default 'manual' så befintliga rader inte påverkas.
alter table bookings
  add column if not exists source text default 'manual';

-- 2) external_id: Booking.coms boknings-ID som stabil extern nyckel.
--    Vår interna primärnyckel `id` håller redan boknings-numret för
--    XLS-importer, men kan suffixas för multi-rumsbokningar (t.ex.
--    "4123456789-1"). external_id håller alltid det råa numret så att
--    mejl/iCal kan matcha mot rätt bokning.
alter table bookings
  add column if not exists external_id text;

-- Backfill: för befintliga rader, härled external_id ur id genom att
-- strippa ev. "-N"-suffix från multi-rumsimporter.
update bookings
  set external_id = split_part(id, '-', 1)
  where external_id is null;

-- 3) Index för snabba upserts/uppslag på external_id.
create index if not exists bookings_external_id_idx on bookings (external_id);

-- 4) Aktivera Realtime på bookings (om inte redan tillagd i publikationen).
--    Detta är det som gör att React-appen får INSERT/UPDATE/DELETE live.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'bookings'
  ) then
    alter publication supabase_realtime add table bookings;
  end if;
end $$;

-- 5) Säkerställ att DELETE/UPDATE-payloads innehåller primärnyckeln
--    (default replica identity = primary key, men vi är explicita).
alter table bookings replica identity default;
