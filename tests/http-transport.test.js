'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  HttpTransport,
  defaultTrustedRedirect,
  _internals
} = require('../src/main/protocol/http-transport');

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

test('plain HTTP is rejected unless the caller explicitly allows it', async () => {
  const transport = new HttpTransport();
  await assert.rejects(
    transport.requestBuffer('http://127.0.0.1:1/', { timeoutMs: 100 }),
    (error) => error?.code === 'HTTP_NOT_ALLOWED'
  );
});

test('cross-origin redirects strip credentials but preserve harmless headers', async (t) => {
  let receivedHeaders = null;
  const destination = await listen((req, res) => {
    receivedHeaders = req.headers;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  });
  const source = await listen((_req, res) => {
    res.statusCode = 302;
    res.setHeader('location', `${destination.url}/collect`);
    res.end();
  });
  t.after(async () => {
    await Promise.all([source.close(), destination.close()]);
  });

  const response = await new HttpTransport().requestJson(`${source.url}/start`, {
    allowHttp: true,
    headers: {
      Cookie: 'music-token=secret',
      Authorization: 'Bearer secret',
      'x-access-code': 'secret-code',
      'x-access-source': 'app',
      'x-request-id': 'safe-value'
    }
  });

  assert.deepEqual(response.data, { ok: true });
  assert.equal(receivedHeaders.cookie, undefined);
  assert.equal(receivedHeaders.authorization, undefined);
  assert.equal(receivedHeaders['x-access-code'], undefined);
  assert.equal(receivedHeaders['x-access-source'], undefined);
  assert.equal(receivedHeaders['x-request-id'], 'safe-value');
});

test('same-origin redirects keep the NAS session cookie', async (t) => {
  let receivedCookie = null;
  const origin = await listen((req, res) => {
    if (req.url === '/start') {
      res.statusCode = 302;
      res.setHeader('location', '/target');
      res.end();
      return;
    }
    receivedCookie = req.headers.cookie;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  });
  t.after(() => origin.close());

  const response = await new HttpTransport().requestJson(`${origin.url}/start`, {
    allowHttp: true,
    headers: { Cookie: 'music-token=session-token' }
  });

  assert.deepEqual(response.data, { ok: true });
  assert.equal(receivedCookie, 'music-token=session-token');
});

test('HTTPS redirects within official FN relay domains keep relay credentials', () => {
  const pairs = [
    ['https://pkxutao.fnos.net/music/', 'https://pkxutao.5ddd.com/music/'],
    ['https://pkxutao.5ddd.com/music/', 'https://fnos.net/pkxutao/music/'],
    ['https://fnos.net/pkxutao/music/', 'https://gateway.fnos.net/music/']
  ];
  for (const [from, to] of pairs) {
    assert.equal(defaultTrustedRedirect(new URL(from), new URL(to)), true, `${from} -> ${to}`);
  }
});

test('relay credential trust never extends outside HTTPS official FN domains', () => {
  assert.equal(
    defaultTrustedRedirect(
      new URL('https://pkxutao.fnos.net/music/'),
      new URL('https://attacker.example/collect')
    ),
    false
  );
  assert.equal(
    defaultTrustedRedirect(
      new URL('https://pkxutao.fnos.net/music/'),
      new URL('http://pkxutao.5ddd.com/music/')
    ),
    false
  );
  assert.equal(_internals.isOfficialFnRelayHost('fakefnos.net'), false);
  assert.equal(_internals.isOfficialFnRelayHost('fnos.net.attacker.example'), false);
});