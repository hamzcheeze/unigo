#!/usr/bin/env python3
import concurrent.futures
import json
import os
import random
import subprocess
import time
import uuid

url = os.environ['TEST_DATABASE_URL']
psql = os.environ.get('PSQL', 'psql')

def sql(statement):
    return subprocess.check_output([psql, url, '-X', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', statement], text=True).strip()

def payload(session, sequence, captured):
    return json.dumps({'vehicleId': 'SHUTTLE-03', 'sessionId': session, 'sequence': sequence,
        'latitude': 13.745, 'longitude': 100.561, 'capturedAtMs': captured,
        'accuracyMeters': 5, 'speedMetersPerSecond': None, 'bearingDegrees': None, 'mock': False})

def submit(args):
    data = payload(*args).replace("'", "''")
    return json.loads(sql("select public.ingest_position('" + data + "'::jsonb)"))

sql("delete from public.vehicle_positions where vehicle_id='SHUTTLE-03'; delete from gogo_private.retired_sessions where vehicle_id='SHUTTLE-03';")
try:
    first = str(uuid.uuid4())
    captured = int(time.time() * 1000)
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        results = list(pool.map(submit, [(first, 1, captured)] * 12))
    assert sum(result['accepted'] for result in results) == 1, results
    assert sql("select revision from public.vehicle_positions where vehicle_id='SHUTTLE-03'") == '1'
    print('PASS 12 simultaneous duplicate submissions commit exactly once')
    sequence = list(range(2, 26))
    random.Random(0).shuffle(sequence)
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        list(pool.map(submit, [(first, number, captured) for number in sequence]))
    assert sql("select sequence from public.vehicle_positions where vehicle_id='SHUTTLE-03'") == '25'
    print('PASS concurrent out-of-order submissions leave highest sequence as latest')
    second = str(uuid.uuid4())
    assert submit((second, 1, captured + 1000))['accepted'] is True
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        retired_results = list(pool.map(submit, [(first, number, captured + 2000) for number in range(30, 42)]))
    assert all(result == {'accepted': False, 'reason': 'retired_session'} for result in retired_results)
    assert sql("select session_id::text from public.vehicle_positions where vehicle_id='SHUTTLE-03'") == second
    print('PASS 12 late retired-session requests cannot revive old trip')
finally:
    sql("delete from public.vehicle_positions where vehicle_id='SHUTTLE-03'; delete from gogo_private.retired_sessions where vehicle_id='SHUTTLE-03';")
