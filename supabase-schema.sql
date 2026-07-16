-- ============================================
-- Hotell Vänersborg – Supabase Schema
-- Kör detta i Supabase SQL Editor
-- ============================================

-- Rooms table
create table rooms (
  id text primary key,           -- t.ex. "101", "102"
  name text not null,            -- t.ex. "Rum 101"
  type text,                     -- t.ex. "Balkongrum", "Budgetrum"
  floor integer,
  capacity integer default 2,
  notes text,
  property_id text not null default 'vanersborg',  -- hotell: 'vanersborg' | 'bralanda'
  active boolean not null default true,            -- upplagt/bokningsbart på Booking.com?
  created_at timestamptz default now()
);

-- Bookings table (imported from Booking.com XLS)
create table bookings (
  id text primary key,           -- Booking.com booking number
  guest_name text not null,
  checkin date not null,
  checkout date not null,
  unit_type text,                -- Kategori från Booking.com, t.ex. "Balkongrum (18 & 19)"
  room_id text references rooms(id),  -- Tilldelat av admin
  people integer default 1,
  status text default 'ok',     -- 'ok' | 'cancelled_by_guest'
  remarks text,
  price text,
  property_id text not null default 'vanersborg',  -- vilket hotell bokningen gäller
  paid boolean not null default false,             -- har gästen betalat för sin vistelse?
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Cleaning / housekeeping status per room per day
create table housekeeping (
  id uuid primary key default gen_random_uuid(),
  room_id text references rooms(id) not null,
  date date not null,
  cleaning_status text default 'pending',  -- 'pending' | 'in_progress' | 'done'
  checkout_done boolean default false,
  checkin_done boolean default false,
  notes text,
  updated_by text,
  property_id text not null default 'vanersborg',  -- vilket hotell raden gäller
  updated_at timestamptz default now(),
  unique(room_id, date)
);

-- ============================================
-- Row Level Security
-- ============================================

alter table rooms enable row level security;
alter table bookings enable row level security;
alter table housekeeping enable row level security;

-- Everyone can read (staff + admin)
create policy "read_rooms" on rooms for select using (true);
create policy "read_bookings" on bookings for select using (true);
create policy "read_housekeeping" on housekeeping for select using (true);

-- Only authenticated users can write
create policy "write_rooms" on rooms for all using (auth.role() = 'authenticated');
create policy "write_bookings" on bookings for all using (auth.role() = 'authenticated');
create policy "write_housekeeping" on housekeeping for all using (auth.role() = 'authenticated');

-- ============================================
-- Seed rooms – Hotell Vänersborg
-- Anpassa rum-ID och namn efter verkligheten!
-- ============================================

insert into rooms (id, name, type, floor, capacity) values
  ('9',  'Rum 9',  'Familjesviten',          1, 4),
  ('10', 'Rum 10', 'Budgetrum',               1, 2),
  ('11', 'Rum 11', 'French Balcony Room',     1, 2),
  ('12', 'Rum 12', 'French Balcony Room',     1, 2),
  ('13', 'Rum 13', 'French Balcony Room',     1, 2),
  ('14', 'Rum 14', 'French Balcony Room',     1, 2),
  ('15', 'Rum 15', 'Budgetrum',               1, 2),
  ('16', 'Rum 16', 'Familjesviten',           1, 4),
  ('17', 'Rum 17', 'Studio med kök',          2, 2),
  ('18', 'Rum 18', 'Balkongrum',              2, 2),
  ('19', 'Rum 19', 'Balkongrum',              2, 2),
  ('20', 'Rum 20', 'Premiumrum',              2, 2);
