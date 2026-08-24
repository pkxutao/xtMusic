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

test('recognizes plain FN IDs and creates both current FNOS fallback URL forms', () => {
  assert.equal(normalizeFnId('pkxutao'), 'pkxutao');
  assert.equal(normalizeFnId('https://pkxutao.fnos.net/music/'), 'pkxutao');
  assert.equal(normalizeFnId('https://fnos.net/pkxutao/music/'), 'pkxutao');

  const discovery = new FnDiscovery({});
  assert.equal(discovery.isFnId('pkxutao'), true);
  assert.equal(discovery.isFnId('https://pkxutao.fnos.net'), false);
  assert.equal(discovery.isFnId('https://pkxutao.fnos.net/music/'), false);

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

test('explicit FNOS music URL is honored exactly and never sent through FN ID discovery', async () => {
  const calls = [];
  let discoveryCalls = 0;
  const transport = {
    async requestJson() {
      discoveryCalls += 1;
      throw new Error('explicit URL must not call FN discovery');
    },
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

  assert.equal(discoveryCalls, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://pkxutao.fnos.net/music/');
  assert.equal(calls[0].options.headers.Cookie, 'mode=relay');
  assert.equal(result.serverUrl, 'https://pkxutao.fnos.net');
  assert.equal(result.fnId, null);
  assert.equal(result.relayMode, true);
});

test('explicit FNOS origin without /music remains a direct relay address', async () => {
  const calls = [];
  const transport = {
    async requestJson() {
      assert.fail('explicit URL must not call FN discovery');
    },
    async requestBuffer(url, options) {
      calls.push({ url, options });
      return { statusCode: 200, url, headers: {}, body: Buffer.alloc(0) };
    }
  };

  const result = await new FnDiscovery(transport).resolve('https://pkxutao.fnos.net');

  assert.equal(calls[0].url, 'https://pkxutao.fnos.net/');
  assert.equal(calls[0].options.headers.Cookie, 'mode=relay');
  assert.equal(result.serverUrl, 'https://pkxutao.fnos.net');
  assert.equal(result.relayMode, true);
});

test('probe redirects are diagnostic only and cannot rewrite the Music API base', async () => {
  const transport = {
    async requestJson() {
      assert.fail('explicit URL must not call FN discovery');
    },
    async requestBuffer(url) {
      return {
        statusCode: 200,
        // Simulate a gateway or portal redirect. The API base must remain the
        // exact FNOS address chosen by the user, not this final probe URL.
        url: 'https://gateway.fnos.net/portal/session',
        headers: {},
        body: Buffer.alloc(0)
      };
    }
  };

  const result = await new FnDiscovery(transport).resolve(
    'https://pkxutao.fnos.net/music/'
  );

  assert.equal(result.serverUrl, 'https://pkxutao.fnos.net');
  assert.equal(result.diagnostics[0].resolvedUrl, 'https://gateway.fnos.net/portal/session');
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