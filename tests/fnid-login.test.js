'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FnDiscovery,
  buildDirectCandidates,
  buildFnIdFallbackCandidates,
  normalizeFnId,
  normalizeServiceUrl
} = require('../src/main/protocol/fn-discovery');

test('normalizes FNOS music URLs to the server base without duplicating /music', () => {
  assert.equal(
    normalizeServiceUrl('https://pkxutao.fnos.net/music/'),
    'https://pkxutao.fnos.net'
  );
  assert.equal(
    normalizeServiceUrl('https://fnos.net/pkxutao/music/api/v1/'),
    'https://fnos.net/pkxutao'
  );
});

test('recognizes FN IDs and creates both current FNOS fallback URL forms', () => {
  assert.equal(normalizeFnId('pkxutao'), 'pkxutao');
  assert.equal(normalizeFnId('https://pkxutao.fnos.net/music/'), 'pkxutao');
  assert.equal(normalizeFnId('https://fnos.net/pkxutao/music/'), 'pkxutao');

  const candidates = buildFnIdFallbackCandidates('pkxutao');
  assert.deepEqual(
    candidates.map((item) => item.probeUrl),
    [
      'https://pkxutao.fnos.net/music/',
      'https://fnos.net/pkxutao/music/'
    ]
  );
  assert.ok(candidates.every((item) => item.relayMode));
});

test('direct FNOS music URL is probed as supplied and returned as a clean server base', async () => {
  const calls = [];
  const transport = {
    async requestBuffer(url, options) {
      calls.push({ url, options });
      return {
        statusCode: 200,
        url,
        headers: {},
        body: Buffer.alloc(0)
      };
    }
  };

  const result = await new FnDiscovery(transport).resolve(
    'https://pkxutao.fnos.net/music/'
  );

  assert.equal(calls[0].url, 'https://pkxutao.fnos.net/music/');
  assert.equal(calls[0].options.headers.Cookie, 'mode=relay');
  assert.equal(result.serverUrl, 'https://pkxutao.fnos.net');
  assert.equal(result.relayMode, true);
});

test('bare FN ID falls back to fnos.net when the 5ddd discovery API is unavailable', async () => {
  const calls = [];
  const transport = {
    async requestJson() {
      const error = new Error('5ddd lookup blocked');
      error.code = 'DNS_ERROR';
      throw error;
    },
    async requestBuffer(url, options) {
      calls.push({ url, options });
      if (url === 'https://pkxutao.fnos.net/music/') {
        return {
          statusCode: 200,
          url,
          headers: {},
          body: Buffer.alloc(0)
        };
      }
      const error = new Error(`unexpected probe ${url}`);
      error.code = 'NETWORK_ERROR';
      throw error;
    }
  };

  const progress = [];
  const result = await new FnDiscovery(transport).resolve(
    'pkxutao',
    {},
    (item) => progress.push(item)
  );

  assert.equal(result.serverUrl, 'https://pkxutao.fnos.net');
  assert.equal(result.fnId, 'pkxutao');
  assert.equal(result.relayMode, true);
  assert.equal(calls[0].url, 'https://pkxutao.fnos.net/music/');
  assert.ok(progress.some((item) => item.phase === 'discovery-fallback'));
});

test('FNOS public domains do not get invalid :5667 fallback candidates', () => {
  const candidates = buildDirectCandidates('https://pkxutao.fnos.net/music/');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].relayMode, true);
  assert.ok(!candidates[0].url.includes(':5667'));
});
