-- Nyckelskåp: 6 fasta skåpsplatser per hotell där personal kan ange
-- vilket rums nycklar som ligger i respektive skåp.
create table if not exists key_cabinet (
  id uuid primary key default gen_random_uuid(),
  property_id text not null,
  slot_number integer not null,
  room_id text references rooms(id),
  updated_at timestamptz default now(),
  unique(property_id, slot_number)
);

alter table key_cabinet enable row level security;

create policy "read_key_cabinet" on key_cabinet for select using (true);
create policy "write_key_cabinet" on key_cabinet for all using (auth.role() = 'authenticated');

insert into key_cabinet (property_id, slot_number) values
  ('bralanda', 1), ('bralanda', 2), ('bralanda', 3),
  ('bralanda', 4), ('bralanda', 5), ('bralanda', 6)
on conflict (property_id, slot_number) do nothing;
