-- Attendance machine database. Paste into the Supabase SQL editor and run once.

create table settings (
  id int primary key default 1 check (id = 1),
  morning_start time not null default '09:00',
  morning_end   time not null default '14:00',
  evening_start time not null default '15:00',
  evening_end   time not null default '20:00',
  late_buffer   int  not null default 5,
  early_buffer  int  not null default 10,
  device_secret_hash text,
  last_seen     timestamptz,
  last_cleanup  date,
  staff_version int not null default 1
);
insert into settings (id) values (1);

create table employees (
  id bigint generated always as identity primary key,
  name text not null,
  finger_id int check (finger_id between 1 and 200),
  registered boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index employees_finger_unique on employees (finger_id) where finger_id is not null;

-- Hours and buffers per person. A new row applies from effective_from onward,
-- so past days keep the hours they were judged by.
create table shifts (
  employee_id bigint not null references employees (id) on delete cascade,
  effective_from date not null,
  morning_start time not null,
  morning_end   time not null,
  evening_start time not null,
  evening_end   time not null,
  late_buffer   int  not null check (late_buffer >= 0),
  early_buffer  int  not null check (early_buffer >= 0),
  primary key (employee_id, effective_from)
);

create table scans (
  id bigint generated always as identity primary key,
  employee_id bigint not null references employees (id) on delete cascade,
  scanned_at timestamptz not null,
  source text not null default 'device' check (source in ('device', 'manual')),
  slot_override smallint check (slot_override between 1 and 4),
  unique (employee_id, scanned_at)
);
create index scans_time on scans (scanned_at);

-- History of every manual change. Keeps the original time and the reason.
create table scan_edits (
  id bigint generated always as identity primary key,
  employee_id bigint not null references employees (id) on delete cascade,
  action text not null check (action in ('added', 'changed', 'removed')),
  old_at timestamptz,
  new_at timestamptz,
  reason text,
  edited_at timestamptz not null default now()
);

-- Jobs the machine picks up when it checks in.
create table commands (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('enroll', 'delete')),
  finger_id int not null,
  employee_id bigint references employees (id) on delete cascade,
  name text,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  step text,
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------
-- Security: only the signed-in owner can use the tables directly.
-- ------------------------------------------------------------------
alter table settings   enable row level security;
alter table employees  enable row level security;
alter table shifts     enable row level security;
alter table scans      enable row level security;
alter table scan_edits enable row level security;
alter table commands   enable row level security;

create policy owner_all on settings   for all to authenticated using (true) with check (true);
create policy owner_all on employees  for all to authenticated using (true) with check (true);
create policy owner_all on shifts     for all to authenticated using (true) with check (true);
create policy owner_all on scans      for all to authenticated using (true) with check (true);
create policy owner_all on scan_edits for all to authenticated using (true) with check (true);
create policy owner_all on commands   for all to authenticated using (true) with check (true);

-- ------------------------------------------------------------------
-- Cleanup: runs at most once a day, from the machine's check-in or the app.
-- ------------------------------------------------------------------
create function run_cleanup() returns void
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  gone record;
begin
  if (select last_cleanup from settings where id = 1) is not distinct from today then
    return;
  end if;
  update settings set last_cleanup = today where id = 1;

  -- A day's records go once that day is more than 30 days old.
  delete from scans where (scanned_at at time zone 'Asia/Kolkata')::date < today - 30;
  delete from scan_edits where (edited_at at time zone 'Asia/Kolkata')::date < today - 30;
  delete from commands where status in ('done', 'failed') and updated_at < now() - interval '30 days';

  -- Deleted staff are removed for good after 7 days, fingerprint included.
  for gone in select id, finger_id, registered from employees
              where deleted_at < now() - interval '7 days' loop
    delete from employees where id = gone.id;
    if gone.registered and gone.finger_id is not null then
      insert into commands (kind, finger_id) values ('delete', gone.finger_id);
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------------
-- Functions the machine calls. Each one checks the machine's secret.
-- ------------------------------------------------------------------
create function check_device(p_secret text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_secret is null or encode(sha256(convert_to(p_secret, 'UTF8')), 'hex')
     is distinct from (select device_secret_hash from settings where id = 1) then
    raise exception 'bad device secret' using errcode = '28000';
  end if;
end $$;

create function device_scan(p_secret text, p_finger_id int, p_epoch bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  emp_id bigint;
begin
  perform check_device(p_secret);
  select id into emp_id from employees where finger_id = p_finger_id and deleted_at is null;
  if emp_id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown finger');
  end if;
  insert into scans (employee_id, scanned_at) values (emp_id, to_timestamp(p_epoch))
    on conflict (employee_id, scanned_at) do nothing;
  return jsonb_build_object('ok', true);
end $$;

create function device_poll(p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cmd record;
begin
  perform check_device(p_secret);
  update settings set last_seen = now() where id = 1;
  perform run_cleanup();

  -- A job that stalled (machine restarted) or was never picked up in time.
  update commands set status = 'failed', message = 'Machine did not finish in time', updated_at = now()
    where status = 'running' and updated_at < now() - interval '3 minutes';
  update commands set status = 'failed', message = 'Machine was not reachable', updated_at = now()
    where status = 'pending' and kind = 'enroll' and created_at < now() - interval '10 minutes';

  select id, kind, finger_id, name into cmd from commands
    where status = 'pending' order by id limit 1;

  return jsonb_build_object(
    'staff_version', (select staff_version from settings where id = 1),
    'command', case when cmd.id is null then null else jsonb_build_object(
      'id', cmd.id, 'kind', cmd.kind, 'finger_id', cmd.finger_id, 'name', cmd.name) end);
end $$;

create function device_staff(p_secret text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform check_device(p_secret);
  return jsonb_build_object(
    'staff_version', (select staff_version from settings where id = 1),
    'staff', coalesce((select jsonb_object_agg(finger_id::text, name) from employees
                       where registered and deleted_at is null and finger_id is not null), '{}'::jsonb));
end $$;

create function device_command_update(p_secret text, p_id bigint, p_status text, p_step text, p_message text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  cmd record;
begin
  perform check_device(p_secret);
  update commands set status = p_status, step = p_step, message = p_message, updated_at = now()
    where id = p_id returning kind, employee_id into cmd;
  if p_status = 'done' and cmd.kind = 'enroll' then
    update employees set registered = true where id = cmd.employee_id;
    update settings set staff_version = staff_version + 1 where id = 1;
  end if;
end $$;

-- ------------------------------------------------------------------
-- Functions the owner's app calls.
-- ------------------------------------------------------------------
create function start_enroll(p_name text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  free_id int;
  emp_id bigint;
  cmd_id bigint;
begin
  select n into free_id from generate_series(1, 200) n
    where not exists (select 1 from employees where finger_id = n)
      and not exists (select 1 from commands where finger_id = n and status in ('pending', 'running'))
    order by n limit 1;
  if free_id is null then
    raise exception 'All 200 fingerprint slots are in use';
  end if;

  insert into employees (name, finger_id) values (trim(p_name), free_id) returning id into emp_id;
  insert into shifts (employee_id, effective_from, morning_start, morning_end, evening_start, evening_end, late_buffer, early_buffer)
    select emp_id, (now() at time zone 'Asia/Kolkata')::date, morning_start, morning_end, evening_start, evening_end, late_buffer, early_buffer
    from settings where id = 1;
  insert into commands (kind, finger_id, employee_id, name) values ('enroll', free_id, emp_id, trim(p_name))
    returning id into cmd_id;
  return cmd_id;
end $$;

create function retry_enroll(p_employee_id bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  emp record;
  cmd_id bigint;
begin
  select * into emp from employees where id = p_employee_id and not registered;
  if emp.id is null then
    raise exception 'This employee is already registered';
  end if;
  insert into commands (kind, finger_id, employee_id, name) values ('enroll', emp.finger_id, emp.id, emp.name)
    returning id into cmd_id;
  return cmd_id;
end $$;

create function soft_delete_employee(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update commands set status = 'failed', message = 'Employee deleted', updated_at = now()
    where employee_id = p_id and status = 'pending';
  if exists (select 1 from employees where id = p_id and not registered) then
    delete from employees where id = p_id;  -- never finished registering, nothing to keep
  else
    update employees set deleted_at = now() where id = p_id;
    update settings set staff_version = staff_version + 1 where id = 1;
  end if;
end $$;

create function restore_employee(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  update employees set deleted_at = null where id = p_id;
  update settings set staff_version = staff_version + 1 where id = 1;
end $$;

-- ------------------------------------------------------------------
-- Who may call what.
-- ------------------------------------------------------------------
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function device_scan(text, int, bigint) to anon;
grant execute on function device_poll(text) to anon;
grant execute on function device_staff(text) to anon;
grant execute on function device_command_update(text, bigint, text, text, text) to anon;
grant execute on function run_cleanup() to authenticated;
grant execute on function start_enroll(text) to authenticated;
grant execute on function retry_enroll(bigint) to authenticated;
grant execute on function soft_delete_employee(bigint) to authenticated;
grant execute on function restore_employee(bigint) to authenticated;

-- Live updates: the app hears about new scans within seconds.
alter publication supabase_realtime add table scans, commands, employees;

-- Tables have no access for the public key, only through the functions above.
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
