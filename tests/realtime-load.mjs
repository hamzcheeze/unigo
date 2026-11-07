import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';

if (process.env.ALLOW_LIVE_READ_LOAD !== '1') throw Error('Set ALLOW_LIVE_READ_LOAD=1 for authorized live read-only testing');
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
nextEnv.loadEnvConfig(app, false, { info() {}, error() {} });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const output = resolve(process.env.REALTIME_OUTPUT || resolve(app, '../artifacts/load-test-live'));
mkdirSync(output, { recursive: true });
const runId = randomUUID();
const tiers = (process.env.REALTIME_CONCURRENCY || '10,50,100').split(',').map(Number);
const repetitions = Number(process.env.REALTIME_REPEATS || 2);
const seconds = Number(process.env.REALTIME_SECONDS || 15);
if (!tiers.every(n => Number.isInteger(n) && n > 0 && n <= 100) || !Number.isInteger(repetitions) || repetitions < 1 || !Number.isInteger(seconds) || seconds < 4) throw Error('Invalid live load settings; max concurrency 100, minimum duration 4 seconds');
const clients = new Set();
const results = [];
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { interrupted = true; });
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1] ?? null;
const stats = values => ({ count: values.length, p50: percentile(values, .5), p95: percentile(values, .95), max: values.length ? Math.max(...values) : null });
const connect = () => {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  clients.add(client);
  return client;
};
async function snapshot(client) {
  const started = performance.now();
  const { data, error } = await client.from('vehicle_positions').select('vehicle_id,revision,captured_at,received_at').abortSignal(AbortSignal.timeout(10000));
  if (error || !Array.isArray(data)) throw Error(`Snapshot failed: ${error?.code || 'invalid_body'}`);
  return { latencyMs: performance.now() - started, vehicles: data.map(row => ({ vehicleId: row.vehicle_id, revision: row.revision, capturedAt: row.captured_at, receivedAt: row.received_at, ageSeconds: (Date.now() - Date.parse(row.received_at)) / 1000 })) };
}
const baselineClient = connect();
const baseline = await snapshot(baselineClient);
console.log(JSON.stringify({ baseline }));
try {
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    for (const concurrency of tiers) {
      if (interrupted) throw Error('Interrupted');
      const viewers = [];
      const updates = new Map();
      const connectMs = [];
      const snapshotMs = [];
      const deliveryMs = [];
      const captureToClientMs = [];
      const errors = {};
      const addError = kind => { errors[kind] = (errors[kind] || 0) + 1; };
      let measuring = false;
      let invalidEvents = 0;
      let snapshotCount = 0;
      const joins = [];
      for (let index = 0; index < concurrency; index++) {
        if (interrupted) throw Error('Interrupted');
        const client = connect();
        viewers.push(client);
        const started = performance.now();
        joins.push(new Promise(res => {
          let settled = false;
          const timer = setTimeout(() => { if (!settled) { settled = true; addError('subscription_timeout'); res(false); } }, 15000);
          client.channel(`load-${runId}-${repetition}-${concurrency}-${index}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_positions' }, payload => {
              if (!measuring) return;
              const row = payload.new;
              if (!row || typeof row.vehicle_id !== 'string' || !Number.isSafeInteger(row.revision) || !Number.isFinite(Date.parse(row.received_at)) || !Number.isFinite(Date.parse(row.captured_at))) { invalidEvents++; return; }
              const eventKey = `${row.vehicle_id}:${row.revision}`;
              let update = updates.get(eventKey);
              if (!update) { update = { vehicleId: row.vehicle_id, revision: row.revision, firstSeen: Date.now(), recipients: new Set(), duplicates: 0 }; updates.set(eventKey, update); }
              if (update.recipients.has(index)) update.duplicates++;
              update.recipients.add(index);
              deliveryMs.push(Date.now() - Date.parse(row.received_at));
              captureToClientMs.push(Date.now() - Date.parse(row.captured_at));
            })
            .subscribe(async status => {
              if (status === 'SUBSCRIBED' && !settled) {
                settled = true; clearTimeout(timer); connectMs.push(performance.now() - started);
                try { const result = await snapshot(client); snapshotCount++; snapshotMs.push(result.latencyMs); } catch { addError('snapshot_failure'); }
                res(true);
              } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
                if (!settled) { settled = true; clearTimeout(timer); addError(status); res(false); }
                else if (measuring) addError(status);
              }
            });
        }));
        await sleep(50);
      }
      const joined = (await Promise.all(joins)).filter(Boolean).length;
      const eventLoop = monitorEventLoopDelay({ resolution: 10 });
      eventLoop.enable();
      const cpuStart = process.cpuUsage();
      const startedAt = Date.now();
      measuring = true;
      for (let tick = 0; tick < seconds * 10 && !interrupted; tick++) await sleep(100);
      const endedAt = Date.now();
      measuring = false;
      eventLoop.disable();
      const cpu = process.cpuUsage(cpuStart);
      const interior = [...updates.values()].filter(update => update.firstSeen > startedAt + 1000 && update.firstSeen < endedAt - 1000);
      const missingDeliveries = interior.reduce((sum, update) => sum + concurrency - update.recipients.size, 0);
      const after = await snapshot(baselineClient);
      let revisionGaps = 0;
      const activeIds = new Set([...updates.values()].map(update => update.vehicleId));
      for (const id of activeIds) {
        const revisions = [...updates.values()].filter(update => update.vehicleId === id).map(update => update.revision).sort((a, b) => a - b);
        for (let i = 1; i < revisions.length; i++) revisionGaps += Math.max(0, revisions[i] - revisions[i - 1] - 1);
      }
      const freshGps = activeIds.size > 0 && [...activeIds].every(id => after.vehicles.some(row => row.vehicleId === id && row.ageSeconds < 10 && row.ageSeconds >= -5));
      const result = { repetition, concurrency, joined, snapshotCount, startedAt: new Date(startedAt).toISOString(), elapsedSeconds: (endedAt - startedAt) / 1000, errors, invalidEvents, freshGps, revisionGaps, messages: deliveryMs.length, uniqueUpdates: updates.size, interiorUpdates: interior.length, missingDeliveries, duplicateDeliveries: [...updates.values()].reduce((sum, update) => sum + update.duplicates, 0), connectMs: stats(connectMs), snapshotMs: stats(snapshotMs), receivedAtToClientMs: stats(deliveryMs), capturedAtToClientMs: stats(captureToClientMs), generatorCpuPercentOfOneCore: (cpu.user + cpu.system) / ((endedAt - startedAt) * 10), generatorEventLoopP95Ms: eventLoop.percentile(95) / 1e6, after, updates: [...updates.values()].map(({ recipients, ...update }) => ({ ...update, recipientCount: recipients.size })) };
      results.push(result);
      console.log(JSON.stringify({ ...result, updates: undefined }));
      writeFileSync(resolve(output, 'results.json'), JSON.stringify({ runId, baseline, date: new Date().toISOString(), scope: 'Live read-only Supabase Realtime subscribers plus initial REST snapshot; no driver writes, route provider or map tiles', results }, null, 2));
      await Promise.all(viewers.map(async client => { await client.removeAllChannels(); await client.realtime.disconnect(); clients.delete(client); }));
      if (interrupted || joined !== concurrency || Object.keys(errors).length || invalidEvents || missingDeliveries || revisionGaps || interior.length === 0 || !freshGps) throw Error('Realtime tier failed; stopping higher load');
    }
  }
} finally {
  await Promise.all([...clients].map(async client => { await client.removeAllChannels(); await client.realtime.disconnect(); }));
}
