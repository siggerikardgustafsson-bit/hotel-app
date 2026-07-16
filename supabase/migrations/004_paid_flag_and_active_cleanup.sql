-- ============================================================
-- 004_paid_flag_and_active_cleanup.sql
--
-- 1) Adds `paid` to bookings: has the guest paid for their stay?
--    Bookings brought in automatically from Booking.com default to
--    paid = true (set explicitly by the import/sync code paths);
--    manual/staff-created bookings default to false until checked.
--
-- 2) We no longer show an "ej upplagd på Booking.com" distinction in
--    the UI. Normalize any rooms marked inactive back to active so
--    nothing is displayed/treated as unlisted.
--
-- VAR DU KÖR DEN:
--   Supabase Dashboard → SQL Editor → klistra in → Run
--   (eller: supabase db push om du länkat projektet via CLI)
--
-- Säker att köra om (idempotent).
-- ============================================================

alter table bookings add column if not exists paid boolean not null default false;

update rooms set active = true where active = false;
