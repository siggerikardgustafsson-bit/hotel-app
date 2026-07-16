-- ============================================================
-- 006_bralanda_out_of_order_rooms.sql
--
-- Adds rooms.out_of_order: a room that's temporarily unusable
-- entirely (as opposed to `active`, which just means "listed on
-- Booking.com" — a room can be listed and still be out of order).
-- Out-of-order rooms are shown red-flagged and sorted to the bottom
-- of the calendar.
--
-- Seeds the currently unusable Brålanda rooms: 102, 200, 201, 202,
-- 301 (the merged "301 + 302" apartment), 314, 400, 403.
--
-- VAR DU KÖR DEN:
--   Supabase Dashboard → SQL Editor → klistra in → Run
--
-- Säker att köra om (idempotent).
-- ============================================================

alter table rooms add column if not exists out_of_order boolean not null default false;

update rooms set out_of_order = true
  where property_id = 'bralanda'
    and id in ('102', '200', '201', '202', '301', '314', '400', '403');
