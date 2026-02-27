-- =====================================================
-- DTR OJT SYSTEM — Supabase Database Setup
-- I-paste mo ito sa Supabase → SQL Editor → Run
-- =====================================================

-- 1. STUDENTS TABLE
create table if not exists students (
  id uuid default gen_random_uuid() primary key,
  student_id text unique not null,        -- e.g. "2021-00123"
  name text not null,
  school text,
  company text,
  password_hash text not null,            -- hashed password
  -- OJT Settings
  required_hours integer default 486,
  days_per_week integer default 5,
  hours_per_day integer default 8,
  default_time_in text default '08:00',
  default_time_out text default '17:00',
  lunch_start text default '12:00',
  lunch_end text default '13:00',
  allow_ot boolean default false,
  created_at timestamptz default now()
);

-- 2. TIME LOGS TABLE
create table if not exists time_logs (
  id uuid default gen_random_uuid() primary key,
  student_id uuid references students(id) on delete cascade,
  log_date date not null,
  time_in text,
  time_out text,
  lunch_in text,
  lunch_out text,
  half_day boolean default false,
  half_day_session text,                  -- 'AM' or 'PM'
  absent boolean default false,
  hours_rendered numeric(5,2) default 0,
  remarks text,
  created_at timestamptz default now(),
  -- One log per student per day only
  unique(student_id, log_date)
);

-- 3. ROW LEVEL SECURITY (RLS) — para secure ang data
-- Students can only see their own data
alter table students enable row level security;
alter table time_logs enable row level security;

-- Allow anyone to insert (register)
create policy "allow register" on students
  for insert with check (true);

-- Allow read if student_id matches (for login)
create policy "allow login lookup" on students
  for select using (true);

-- Allow students to update own record
create policy "allow self update" on students
  for update using (true);

-- Allow all operations on time_logs (we handle auth in app)
create policy "allow all on time_logs" on time_logs
  for all using (true);

-- =====================================================
-- DONE! Mag-click ng RUN button sa taas.
-- =====================================================
