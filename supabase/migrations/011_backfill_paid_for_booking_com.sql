-- Alla bokningar markerade som från Booking.com ska räknas som betalda.
-- Migration 010 satte from_booking_com men rörde inte paid — täta den luckan
-- för historiska rader som aldrig markerats betalda manuellt.
update bookings set paid = true
  where property_id = 'bralanda' and from_booking_com = true and paid = false;
