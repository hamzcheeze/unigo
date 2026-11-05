\set ON_ERROR_STOP on
begin;
create function pg_temp.gogo_fix(vehicle text, session text, seq bigint, milliseconds integer default 0) returns jsonb
language sql as $$
select jsonb_build_object('vehicleId', vehicle, 'sessionId', session, 'sequence', seq,
 'latitude', 13.745, 'longitude', 100.561, 'capturedAtMs', floor(extract(epoch from clock_timestamp()) * 1000) + milliseconds,
 'accuracyMeters', 5, 'speedMetersPerSecond', null, 'bearingDegrees', null, 'mock', false);
$$;
do $$
declare
 s1 text := 'a0000000-0000-4000-8000-000000000001';
 s2 text := 'a0000000-0000-4000-8000-000000000002';
 r jsonb;
 revision_before bigint;
begin
 delete from public.vehicle_positions;
 delete from gogo_private.retired_sessions;
 r := public.ingest_position(pg_temp.gogo_fix('SHUTTLE-01', s1, 1));
 assert r = '{"accepted":true,"revision":1}'::jsonb, r::text;
 r := public.ingest_position(pg_temp.gogo_fix('SHUTTLE-01', s1, 1));
 assert r = '{"accepted":false,"reason":"out_of_order"}'::jsonb, r::text;
 r := public.ingest_position(pg_temp.gogo_fix('SHUTTLE-01', s1, 2));
 assert r = '{"accepted":true,"revision":2}'::jsonb, r::text;
 r := public.ingest_position(pg_temp.gogo_fix('SHUTTLE-02', s1, 1));
 assert r = '{"accepted":true,"revision":1}'::jsonb, r::text;
 r := public.ingest_position(pg_temp.gogo_fix('SHUTTLE-01', s2, 1, 1000));
 assert r = '{"accepted":true,"revision":3}'::jsonb, r::text;
 r := public.ingest_position(pg_temp.gogo_fix('SHUTTLE-01', s1, 999, 2000));
 assert r = '{"accepted":false,"reason":"retired_session"}'::jsonb, r::text;
 r := public.ingest_position(pg_temp.gogo_fix('SHUTTLE-01', s2, 2, 0));
 assert r = '{"accepted":false,"reason":"backwards_capture"}'::jsonb, r::text;
 r := public.ingest_position(pg_temp.gogo_fix('SHUTTLE-01', s2, 2, -16000));
 assert r = '{"accepted":false,"reason":"invalid_capture_time"}'::jsonb, r::text;
 r := public.ingest_position(pg_temp.gogo_fix('SHUTTLE-01', s2, 2, 6000));
 assert r = '{"accepted":false,"reason":"invalid_capture_time"}'::jsonb, r::text;
 r := public.ingest_position(pg_temp.gogo_fix('SHUTTLE-03', s1, 1) || '{"mock":true}'::jsonb);
 assert r = '{"accepted":false,"reason":"mock_position"}'::jsonb, r::text;
 select revision into revision_before from public.vehicle_positions where vehicle_id = 'SHUTTLE-01';
 begin
  perform public.ingest_position(pg_temp.gogo_fix('SHUTTLE-01', 'a0000000-0000-4000-8000-000000000003', 1, 2000) || '{"latitude":91}'::jsonb);
  raise exception 'Invalid latitude accepted';
 exception when check_violation then null;
 end;
 assert not exists(select 1 from gogo_private.retired_sessions where vehicle_id='SHUTTLE-01' and session_id=s2::uuid), 'Failed write retired current session';
 assert (select revision from public.vehicle_positions where vehicle_id='SHUTTLE-01') = revision_before, 'Failed write changed latest row';
 assert has_table_privilege('anon', 'public.vehicle_positions', 'SELECT'), 'anon cannot read positions';
 assert not has_table_privilege('anon', 'public.vehicle_positions', 'UPDATE'), 'anon can update';
 assert not has_table_privilege('authenticated', 'public.vehicle_positions', 'INSERT'), 'authenticated can insert';
 assert not has_schema_privilege('anon', 'gogo_private', 'USAGE'), 'private metadata visible';
 assert not has_function_privilege('anon', 'public.ingest_position(jsonb)', 'EXECUTE'), 'anon can ingest';
 assert not has_function_privilege('authenticated', 'public.ingest_position(jsonb)', 'EXECUTE'), 'authenticated can ingest';
 assert has_function_privilege('service_role', 'public.ingest_position(jsonb)', 'EXECUTE'), 'service role cannot ingest';
 raise notice 'PASS atomic revisions, duplicate/order rejection, vehicle isolation, session retirement, clock bounds, mock rejection, rollback, and grants';
end;
$$;
set local role anon;
select vehicle_id, revision from public.vehicle_positions order by vehicle_id;
reset role;
rollback;
