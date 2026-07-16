-- Flagga för att skilja Booking.com-importerade bokningar från manuellt inlagda.
alter table bookings add column if not exists from_booking_com boolean not null default false;

-- Backfill: bokningar vars ID inte börjar med "manual-" kommer från Booking.com-importen.
update bookings set from_booking_com = true where id not like 'manual-%';
