-- ============================================================
-- 003_bralanda_property.sql
-- Multi-property-stöd: lägger till `property_id` på rooms/bookings/
-- housekeeping så att flera hotell kan ligga i samma databas, samt
-- en `active`-flagga på rooms (är rummet upplagt/bokningsbart på
-- Booking.com?). Seedar därefter alla Brålanda-rum.
--
-- VAR DU KÖR DEN:
--   Supabase Dashboard → SQL Editor → klistra in → Run
--   (eller: supabase db push om du länkat projektet via CLI)
--
-- Säker att köra om (idempotent).
-- ============================================================

-- 1) property_id på alla tre tabeller. Default 'vanersborg' gör att
--    ALLA befintliga rader (det gamla hotellet) automatiskt backfillas
--    till Vänersborg. Brålanda-rader får 'bralanda'.
alter table rooms        add column if not exists property_id text not null default 'vanersborg';
alter table bookings     add column if not exists property_id text not null default 'vanersborg';
alter table housekeeping add column if not exists property_id text not null default 'vanersborg';

-- 2) active: visas rummet som upplagt på Booking.com? Default true så att
--    befintliga Vänersborg-rum behåller sitt nuvarande beteende.
alter table rooms add column if not exists active boolean not null default true;

-- 3) Index för snabb filtrering per hotell.
create index if not exists rooms_property_idx        on rooms (property_id);
create index if not exists bookings_property_idx     on bookings (property_id);
create index if not exists housekeeping_property_idx on housekeeping (property_id);

-- 4) Seed Brålanda-rum.
--    Kategori (type) + maxbeläggning (capacity) enligt fastighetens lista.
--    active = true endast för de rum som just nu är upplagda på Booking.com:
--      102, 103, 104, 307, 401, 402, 404, 405 samt lägenhetsenheterna
--      308+309 (rad-id 309) och 310+311 (rad-id 311).
--    Vandrarhemslägenheterna (301, 303, 306, 309, 311, 313) är fysiskt två
--    ihopkopplade rum men ligger på Booking.com som EN enhet → en rad var.
--    Lägenheterna 308+309 och 310+311 absorberar rum 308 resp. 310, som
--    därför INTE finns som egna bokningsbara rum.
--    do nothing = kör om utan att skriva över manuella ändringar i UI:t.
insert into rooms (id, name, type, floor, capacity, property_id, active) values
  ('101', 'Rum 101', 'Vandrarhemsrum',          1, 1, 'bralanda', false),
  ('102', 'Rum 102', 'Hotellrum m. pentry',     1, 4, 'bralanda', true),
  ('103', 'Rum 103', 'Hotellrum m. pentry',     1, 4, 'bralanda', true),
  ('104', 'Rum 104', 'Hotellrum m. pentry',     1, 4, 'bralanda', true),
  ('105', 'Rum 105', 'Hotellrum m. pentry',     1, 4, 'bralanda', false),
  ('200', 'Rum 200', 'Vandrarhemsrum',          2, 1, 'bralanda', false),
  ('201', 'Rum 201', 'Vandrarhemsrum',          2, 2, 'bralanda', false),
  ('202', 'Rum 202', 'Vandrarhemsrum',          2, 2, 'bralanda', false),
  ('203', 'Rum 203', 'Vandrarhemsrum',          2, 2, 'bralanda', false),
  ('204', 'Rum 204', 'Vandrarhemsrum',          2, 2, 'bralanda', false),
  ('205', 'Rum 205', 'Vandrarhemsrum',          2, 2, 'bralanda', false),
  ('206', 'Rum 206', 'Vandrarhemsrum',          2, 2, 'bralanda', false),
  ('207', 'Rum 207', 'Vandrarhemsrum',          2, 2, 'bralanda', false),
  ('208', 'Rum 208', 'Vandrarhemsrum',          2, 1, 'bralanda', false),
  ('301', 'Rum 301', 'Vandrarhemslägenhet',     3, 6, 'bralanda', false),
  ('302', 'Rum 302', 'Vandrarhemsrum m. WC',    3, 2, 'bralanda', false),
  ('303', 'Rum 303', 'Vandrarhemslägenhet',     3, 6, 'bralanda', false),
  ('304', 'Rum 304', 'Vandrarhemsrum m. WC',    3, 2, 'bralanda', false),
  ('305', 'Rum 305', 'Vandrarhemsrum m. WC',    3, 2, 'bralanda', false),
  ('306', 'Rum 306', 'Vandrarhemslägenhet',     3, 6, 'bralanda', false),
  ('307', 'Rum 307', 'Hotellrum',               3, 2, 'bralanda', true),
  ('309', 'Rum 308+309', 'Vandrarhemslägenhet', 3, 6, 'bralanda', true),
  ('311', 'Rum 310+311', 'Vandrarhemslägenhet', 3, 6, 'bralanda', true),
  ('312', 'Rum 312', 'Vandrarhemsrum m. WC',    3, 2, 'bralanda', false),
  ('313', 'Rum 313', 'Vandrarhemslägenhet',     3, 6, 'bralanda', false),
  ('314', 'Rum 314', 'Vandrarhemsrum',          3, 1, 'bralanda', false),
  ('315', 'Rum 315', 'Fyrbäddsrum',             3, 6, 'bralanda', false),
  ('316', 'Rum 316', 'Fyrbäddsrum',             3, 4, 'bralanda', false),
  ('317', 'Rum 317', 'Vandrarhemsrum',          3, 1, 'bralanda', false),
  ('400', 'Rum 400', 'Specialrum',              4, 1, 'bralanda', false),
  ('401', 'Rum 401', 'Hotellrum',               4, 2, 'bralanda', true),
  ('402', 'Rum 402', 'Hotellrum',               4, 2, 'bralanda', true),
  ('403', 'Rum 403', 'Vandrarhemsrum m. WC',    4, 2, 'bralanda', false),
  ('404', 'Rum 404', 'Hotellrum',               4, 2, 'bralanda', true),
  ('405', 'Rum 405', 'Hotellrum',               4, 2, 'bralanda', true),
  ('501', 'Rum 501', 'Vandrarhemsrum m. WC',    5, 2, 'bralanda', false),
  ('502', 'Rum 502', 'Hotellrum',               5, 2, 'bralanda', false),
  ('503', 'Rum 503', 'Hotellrum',               5, 2, 'bralanda', false),
  ('504', 'Rum 504', 'Juniorsvit',              5, 2, 'bralanda', false),
  ('505', 'Rum 505', 'Vandrarhemsrum',          5, 1, 'bralanda', false)
on conflict (id) do nothing;
