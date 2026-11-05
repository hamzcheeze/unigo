begin;
create schema if not exists gogo_private;
revoke all on schema gogo_private from public, anon, authenticated;

create table if not exists gogo_private.vehicles (
  vehicle_id text primary key check (vehicle_id in ('SHUTTLE-01', 'SHUTTLE-02', 'SHUTTLE-03'))
);
insert into gogo_private.vehicles(vehicle_id) values ('SHUTTLE-01'), ('SHUTTLE-02'), ('SHUTTLE-03') on conflict do nothing;
create table if not exists gogo_private.retired_sessions (
  vehicle_id text not null references gogo_private.vehicles(vehicle_id),
  session_id uuid not null,
  primary key (vehicle_id, session_id)
);
create table if not exists public.vehicle_positions (
  vehicle_id text primary key references gogo_private.vehicles(vehicle_id),
  revision bigint not null check (revision > 0 and revision <= 9007199254740991),
  session_id uuid not null,
  sequence bigint not null check (sequence > 0 and sequence <= 9007199254740991),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_meters double precision check (accuracy_meters between 0 and 100000),
  speed_meters_per_second double precision check (speed_meters_per_second between 0 and 200),
  bearing_degrees double precision check (bearing_degrees >= 0 and bearing_degrees < 360),
  captured_at timestamptz not null,
  received_at timestamptz not null
);
alter table public.vehicle_positions enable row level security;
revoke all on public.vehicle_positions from public, anon, authenticated;
grant select on public.vehicle_positions to anon, authenticated;
drop policy if exists public_vehicle_position_read on public.vehicle_positions;
create policy public_vehicle_position_read on public.vehicle_positions for select to anon, authenticated using (true);

create or replace function public.ingest_position(p_position jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_vehicle text := p_position->>'vehicleId';
  v_session uuid := (p_position->>'sessionId')::uuid;
  v_sequence bigint := (p_position->>'sequence')::bigint;
  v_captured timestamptz := pg_catalog.to_timestamp((p_position->>'capturedAtMs')::double precision / 1000.0);
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_current public.vehicle_positions%rowtype;
  v_revision bigint;
begin
  if coalesce((p_position->>'mock')::boolean, true) then
    return pg_catalog.jsonb_build_object('accepted', false, 'reason', 'mock_position');
  end if;
  if v_captured is null or v_captured < v_now - interval '15 seconds' or v_captured > v_now + interval '5 seconds' then
    return pg_catalog.jsonb_build_object('accepted', false, 'reason', 'invalid_capture_time');
  end if;
  if v_session is null or v_sequence is null or v_sequence < 1 or v_sequence > 9007199254740991 then
    return pg_catalog.jsonb_build_object('accepted', false, 'reason', 'invalid_sequence_or_session');
  end if;
  perform 1 from gogo_private.vehicles where vehicle_id = v_vehicle for update;
  if not found then
    return pg_catalog.jsonb_build_object('accepted', false, 'reason', 'unknown_vehicle');
  end if;
  v_now := pg_catalog.clock_timestamp();
  if v_captured < v_now - interval '15 seconds' or v_captured > v_now + interval '5 seconds' then
    return pg_catalog.jsonb_build_object('accepted', false, 'reason', 'invalid_capture_time');
  end if;
  if exists (select 1 from gogo_private.retired_sessions where vehicle_id = v_vehicle and session_id = v_session) then
    return pg_catalog.jsonb_build_object('accepted', false, 'reason', 'retired_session');
  end if;
  select * into v_current from public.vehicle_positions where vehicle_id = v_vehicle;
  if found then
    if v_current.session_id = v_session and v_sequence <= v_current.sequence then
      return pg_catalog.jsonb_build_object('accepted', false, 'reason', 'out_of_order');
    end if;
    if v_captured < v_current.captured_at or (v_session <> v_current.session_id and v_captured <= v_current.captured_at) then
      return pg_catalog.jsonb_build_object('accepted', false, 'reason', 'backwards_capture');
    end if;
    if v_current.session_id <> v_session then
      insert into gogo_private.retired_sessions(vehicle_id, session_id) values (v_vehicle, v_current.session_id) on conflict do nothing;
    end if;
    v_revision := v_current.revision + 1;
  else
    v_revision := 1;
  end if;
  insert into public.vehicle_positions(vehicle_id, revision, session_id, sequence, latitude, longitude,
    accuracy_meters, speed_meters_per_second, bearing_degrees, captured_at, received_at)
  values (v_vehicle, v_revision, v_session, v_sequence,
    (p_position->>'latitude')::double precision, (p_position->>'longitude')::double precision,
    (p_position->>'accuracyMeters')::double precision, (p_position->>'speedMetersPerSecond')::double precision,
    (p_position->>'bearingDegrees')::double precision, v_captured, pg_catalog.clock_timestamp())
  on conflict (vehicle_id) do update set revision = excluded.revision, session_id = excluded.session_id,
    sequence = excluded.sequence, latitude = excluded.latitude, longitude = excluded.longitude,
    accuracy_meters = excluded.accuracy_meters, speed_meters_per_second = excluded.speed_meters_per_second,
    bearing_degrees = excluded.bearing_degrees, captured_at = excluded.captured_at, received_at = excluded.received_at;
  return pg_catalog.jsonb_build_object('accepted', true, 'revision', v_revision);
end;
$$;
revoke all on function public.ingest_position(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_position(jsonb) to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'vehicle_positions') then
    alter publication supabase_realtime add table public.vehicle_positions;
  end if;
end;
$$;
commit;
