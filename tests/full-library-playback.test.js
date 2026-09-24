'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const esbuild = require('esbuild');

function moduleFrom(relative, globals = {}) {
  const result = esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', relative)],
    bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const module = { exports: {} };
  vm.runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require,
    console, setTimeout, clearTimeout, DOMException, structuredClone, ...globals });
  return module.exports;
}
const { PlaybackOrder, shuffled } = moduleFrom('src/renderer/playback-order.js');
const { collectLibrary, compactTrack, accountScope } = moduleFrom('src/renderer/library-source.js');
const source = { method: 'getTracks', args: {} };
const rows = (count, offset = 0) => Array.from({ length: count }, (_, i) => ({ guid: `track-${offset + i}`, title: `Track ${offset + i}` }));
function fakeLibrary(count, { cap = 400, totalKnown = true } = {}) {
  const calls = [];
  const call = async (method, args) => {
    calls.push({ method, ...args });
    const size = Math.min(args.size, cap);
    const offset = (args.page - 1) * size;
    return { list: rows(Math.max(0, Math.min(size, count - offset)), offset),
      total: totalKnown ? count : Math.min(size, count), totalKnown };
  };
  return { call, calls };
}

test('all 12,345 tracks across 31 pages become candidates, not just the first 400', async () => {
  const api = fakeLibrary(12345);
  const progress = [];
  const index = await collectLibrary(api.call, source, { onProgress: (p) => progress.push(p.loaded) });
  assert.equal(index.complete, true);
  assert.equal(index.tracks.length, 12345);
  assert.equal(new Set(index.tracks.map((t) => t.guid)).size, 12345);
  assert.equal(index.tracks.at(-1).guid, 'track-12344');
  assert.equal(api.calls.length, 31);
  assert.equal(progress.at(-1), 12345);
  assert.ok(api.calls.every((call) => call.size <= 400));
});

test('100,001 tracks do not hit the old 30,000 helper limit', async () => {
  const api = fakeLibrary(100001);
  const index = await collectLibrary(api.call, source);
  assert.equal(index.tracks.length, 100001);
  assert.equal(api.calls.length, 251);
});

test('server-side page cap of 200 is negotiated without skipping tracks', async () => {
  const api = fakeLibrary(1201, { cap: 200 });
  const result = await collectLibrary(api.call, source);
  assert.equal(result.total, 1201);
  assert.equal(api.calls[1].size, 200);
  assert.equal(new Set(result.tracks.map((t) => t.guid)).size, 1201);
});

test('missing total is scanned to an empty page, never inferred from the first page', async () => {
  const api = fakeLibrary(1001, { cap: 200, totalKnown: false });
  assert.equal((await collectLibrary(api.call, source)).total, 1001);
  assert.equal(api.calls.at(-1).page, 7);
});

test('empty and single-track libraries terminate normally', async () => {
  assert.equal((await collectLibrary(fakeLibrary(0).call, source)).total, 0);
  assert.equal((await collectLibrary(fakeLibrary(1).call, source)).total, 1);
});

test('repeated pages, disappearing totals, early empties and network failures cannot create complete indexes', async () => {
  await assert.rejects(collectLibrary(async () => ({ list: rows(400), total: 800 }), source), /重复/);
  await assert.rejects(collectLibrary(async (_m, a) => ({ list: a.page === 1 ? rows(400) : [], total: 800 }), source), /空页/);
  await assert.rejects(collectLibrary(async (_m, a) => ({ list: rows(400, (a.page - 1) * 400), total: a.page === 1 ? 800 : 801 }), source), /变化/);
  await assert.rejects(collectLibrary(async (_m, a) => { if (a.page === 2) throw Error('offline'); return { list: rows(400), total: 800 }; }, source), /offline/);
});

test('cancel during a pending request stops immediately, with no follow-up requests', async () => {
  const controller = new AbortController();
  let calls = 0;
  let release;
  const pending = collectLibrary(async () => { calls += 1; return new Promise((resolve) => { release = resolve; }); }, source, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  release({ list: rows(1), total: 1 });
  assert.equal(calls, 1);
});

test('index metadata never retains credentials or audio bytes from arbitrary server fields', () => {
  const value = compactTrack({ ...rows(1)[0], token: 'secret', password: 'secret', url: 'https://server/?token=secret',
    audioSpec: { duration: 230, codec: 'flac', token: 'secret' }, album: { guid: 'a', name: 'A', password: 'secret' } });
  assert.equal(value.duration, 230);
  assert.doesNotMatch(JSON.stringify(value), /secret|password|token/);
});

test('same username on different servers and different users on one server have separate storage', () => {
  assert.notEqual(accountScope({ serverUrl: 'a', username: 'u' }), accountScope({ serverUrl: 'b', username: 'u' }));
  assert.notEqual(accountScope({ serverUrl: 'a', username: 'u' }), accountScope({ serverUrl: 'a', username: 'v' }));
  assert.equal(accountScope({ serverUrl: 'a', username: 'u', id: 'old' }), accountScope({ serverUrl: 'a', username: 'u', id: 'new' }));
});

test('Fisher-Yates returns a complete permutation without mutating the input', () => {
  const input = Array.from({ length: 20000 }, (_, i) => i);
  const actual = shuffled(input);
  assert.equal(new Set(actual).size, input.length);
  assert.equal(input[0], 0);
  assert.equal(input.at(-1), 19999);
});

test('one full shuffle round visits every track exactly once, including the last page', () => {
  const order = new PlaybackOrder(12000, { shuffle: true, start: null });
  const sequence = [];
  let next;
  while ((next = order.next()) != null) sequence.push(next);
  assert.equal(sequence.length, 12000);
  assert.equal(new Set(sequence).size, 12000);
  assert.ok(sequence.includes(11999));
  assert.ok(sequence.slice(0, 100).some((i) => i >= 400));
  assert.equal(order.canNext, false);
});

test('previous and forward next follow actual history including an explicit queue jump', () => {
  const order = new PlaybackOrder(1000, { shuffle: true, start: null });
  const first = order.next();
  const second = order.next();
  const third = order.next();
  assert.equal(order.previous(), second);
  assert.equal(order.previous(), first);
  assert.equal(order.next(), second);
  assert.equal(order.next(), third);
  order.jump(999);
  assert.equal(order.previous(), third);
  assert.equal(order.next(), 999);
});

test('repeat-all starts a new permutation and avoids immediate cross-round repetition', () => {
  const order = new PlaybackOrder(101, { shuffle: true, start: null });
  const first = Array.from({ length: 101 }, () => order.next());
  const second = Array.from({ length: 101 }, () => order.next(true));
  assert.equal(new Set(second).size, 101);
  assert.notEqual(first.at(-1), second[0]);
  assert.equal(order.cycle, 2);
});

test('persisting after track 800 preserves the full 12,000-track round and exact next track', () => {
  const order = new PlaybackOrder(12000, { shuffle: true, start: null });
  for (let i = 0; i < 800; i += 1) order.next();
  const restored = PlaybackOrder.restore(structuredClone(order.snapshot()), 12000);
  assert.equal(restored.count, 12000);
  assert.equal(restored.current, order.current);
  assert.equal(restored.next(), order.next());
  const remaining = [];
  let next;
  while ((next = restored.next()) != null) remaining.push(next);
  assert.equal(remaining.length, 11199);
});

test('corrupt shuffle snapshots are rejected, not silently truncated', () => {
  const order = new PlaybackOrder(10);
  const saved = order.snapshot();
  saved.order[1] = 999;
  assert.throws(() => PlaybackOrder.restore(saved, 10), /缓存/);
});

test('inserting next and removing songs preserves the active round and limits queue DOM to 160', () => {
  const original = rows(1000);
  const order = new PlaybackOrder(1000, { shuffle: true, start: 50 });
  order.next();
  const added = [...original, { guid: 'extra' }];
  order.reconcile(original, added, { next: true });
  assert.equal(order.next(), 1000);
  const current = added[order.current].guid;
  const trimmed = added.filter((track) => track.guid !== 'track-30');
  order.reconcile(added, trimmed);
  assert.equal(trimmed[order.current].guid, current);
  assert.ok(order.window(160).length <= 160);
});

test('current source integration never passes currentTracks to the full-library collector', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/renderer/app.js'), 'utf8');
  assert.match(app, /collectLibrary\(call, source/);
  assert.match(app, /queueRevision !== task.revision/);
  assert.match(app, /scope !== task.scope/);
  assert.doesNotMatch(app, /sort\(\(\) => Math.random\(\) - 0.5\)/);
});
