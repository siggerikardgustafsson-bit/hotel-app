-- ============================================================
-- 005_bralanda_merge_apartment_pairs.sql
--
-- Brålanda's vandrarhemslägenheter (301, 303, 306, 309, 311, 313)
-- were originally modelled as standalone rooms, with the connected
-- "WC-rum"-half of each pair (302, 304, 305, 308, 310, 312) also
-- modelled as a separate standalone bookable room. In reality each
-- apartment is two physically joined rooms sharing one door and is
-- only ever bookable as a single unit.
--
-- 308+309 and 310+311 were already merged in migration 003 (kept as
-- room id '309' / '311'). This migration merges the remaining three
-- pairs (301+302, 303+304, 305+306, 312+313 — four pairs total) by:
--   1. Reassigning any bookings/housekeeping on the discarded half
--      onto the surviving apartment room id.
--   2. Deleting the now-redundant standalone room row.
-- It then relabels all six merged apartments consistently as
-- "NNN + NNN" / "Vandrarhemslägenhet".
--
-- VAR DU KÖR DEN:
--   Supabase Dashboard → SQL Editor → klistra in → Run
--
-- Säker att köra om (idempotent) — reassign/delete steps are no-ops
-- once a pair is already merged.
-- ============================================================

do $$
declare
  pair record;
begin
  for pair in
    select * from (values
      ('301', '302'),  -- becomes "301 + 302"
      ('303', '304'),  -- becomes "303 + 304"
      ('306', '305'),  -- becomes "305 + 306" (apartment's own number is 306)
      ('313', '312')   -- becomes "312 + 313" (apartment's own number is 313)
    ) as t(keep_id, drop_id)
  loop
    -- Housekeeping has a unique(room_id, date) constraint: drop any
    -- losing-room row that would collide with an existing
    -- (keep_id, date) row before moving the rest over.
    delete from housekeeping hk_lose
      using housekeeping hk_win
      where hk_lose.room_id = pair.drop_id
        and hk_win.room_id = pair.keep_id
        and hk_lose.date = hk_win.date
        and hk_lose.property_id = 'bralanda'
        and hk_win.property_id = 'bralanda';

    update housekeeping set room_id = pair.keep_id
      where room_id = pair.drop_id and property_id = 'bralanda';

    update bookings set room_id = pair.keep_id
      where room_id = pair.drop_id and property_id = 'bralanda';

    delete from rooms where id = pair.drop_id and property_id = 'bralanda';
  end loop;
end $$;

update rooms set name = '301 + 302', type = 'Vandrarhemslägenhet', capacity = 6
  where id = '301' and property_id = 'bralanda';
update rooms set name = '303 + 304', type = 'Vandrarhemslägenhet', capacity = 6
  where id = '303' and property_id = 'bralanda';
update rooms set name = '305 + 306', type = 'Vandrarhemslägenhet', capacity = 6
  where id = '306' and property_id = 'bralanda';
update rooms set name = '308 + 309', type = 'Vandrarhemslägenhet', capacity = 6
  where id = '309' and property_id = 'bralanda';
update rooms set name = '310 + 311', type = 'Vandrarhemslägenhet', capacity = 6
  where id = '311' and property_id = 'bralanda';
update rooms set name = '312 + 313', type = 'Vandrarhemslägenhet', capacity = 6
  where id = '313' and property_id = 'bralanda';
