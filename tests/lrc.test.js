'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

async function loadLrcModule() {
  const source = fs.readFileSync(path.join(root, 'src/renderer/lrc.js'), 'utf8');
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('LRC parser supports multiple timestamps, metadata and millisecond offset', async () => {
  const { parseLrc } = await loadLrcModule();
  const result = parseLrc(`\uFEFF[ar:Artist]\n[offset:-250]\n[00:01.50][00:03.000]Hello\n[00:05.25]`);

  assert.equal(result.metadata.ar, 'Artist');
  assert.equal(result.metadata.offsetMs, -250);
  assert.deepEqual(result.lines, [
    { time: 1.25, text: 'Hello' },
    { time: 2.75, text: 'Hello' },
    { time: 5, text: '\u00A0' }
  ]);
});

test('LRC parser removes enhanced word timestamps without corrupting text', async () => {
  const { parseLrc } = await loadLrcModule();
  const result = parseLrc('[00:10.00]<00:10.00>Hello <00:10.40>world');
  assert.deepEqual(result.lines, [{ time: 10, text: 'Hello world' }]);
});

test('active lyric selection uses binary search around exact boundaries', async () => {
  const { activeLyricIndex } = await loadLrcModule();
  const lines = [
    { time: 1, text: 'a' },
    { time: 2.5, text: 'b' },
    { time: 5, text: 'c' }
  ];

  assert.equal(activeLyricIndex(lines, 0.5), -1);
  assert.equal(activeLyricIndex(lines, 2.47), 1);
  assert.equal(activeLyricIndex(lines, 4.9), 1);
  assert.equal(activeLyricIndex(lines, 5), 2);
});
