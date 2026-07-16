-- Rum 317 på Brålanda tas bort helt.
delete from bookings where property_id = 'bralanda' and room_id = '317';
delete from housekeeping where property_id = 'bralanda' and room_id = '317';
delete from rooms where property_id = 'bralanda' and id = '317';
