-- Rum "303 + 304" på Brålanda markeras som ur drift.
update rooms set out_of_order = true
  where property_id = 'bralanda' and id = '303';
