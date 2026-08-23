'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  computeAuthx,
  buildDirectCandidates,
  normalizeFnId,
  isPrivateHost,
  _constants
} = require('../src/main/protocol/fn-discovery');
const { FeiNiuClient, normalizeBaseUrl } = require('../src/main/protocol/feiniu-client');
const {
  rewriteM3u8,
  encodeBase64Url,
  decodeBase64Url
} = require('../src/main/media-protocol');

test('FNID authx matches the documented signing algorithm', () => {
  const data = { fnId: 'demo123' };
  const nonce = '123456';
  const timestamp = '1700000000000';
  const body = JSON.stringify(data);
  const md5 = (value) => crypto.createHash('md5').update(value).digest('hex');
  const raw = [
    _constants.AUTHX_PREFIX,
    _constants.FN_API_PATH,
    nonce,
    timestamp,
    md5(body),
    _constants.API_KEY
  ].join('_');
  const expected = `nonce=${nonce}&timestamp=${timestamp}&sign=${md5(raw)}`;
  assert.equal(
    computeAuthx('post', _constants.FN_API_PATH, data, { nonce, timestamp }),
    expected
  );
});

test('password login uses SHA-256 and never returns the original password', () => {
  const value = 'correct horse battery staple';
  const hash = FeiNiuClient.hashPassword(value);
  assert.equal(hash.length, 64);
  assert.equal(hash, crypto.createHash('sha256').update(value).digest('hex'));
  assert.ok(!hash.includes(value));
});

test('direct HTTP requires explicit consent', () => {
  assert.throws(
    () => buildDirectCandidates('http://192.168.1.10:5666', { allowHttp: false }),
    /HTTP/
  );
  const candidates = buildDirectCandidates('http://192.168.1.10:5666', { allowHttp: true });
  assert.equal(candidates[0].url, 'http://192.168.1.10:5666');
});

test('FNID and private address normalization', () => {
  assert.equal(normalizeFnId('https://abcdef.5ddd.com/'), 'abcdef');
  assert.equal(isPrivateHost('192.168.1.2'), true);
  assert.equal(isPrivateHost('172.16.0.1'), true);
  assert.equal(isPrivateHost('8.8.8.8'), false);
});

test('base URL strips an accidentally supplied API prefix', () => {
  assert.equal(
    normalizeBaseUrl('https://nas.local:5667/music/api/v1/'),
    'https://nas.local:5667'
  );
});

test('HLS playlists are rewritten to the credential-hiding custom protocol', () => {
  const source = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\nsegment-1.ts\n';
  const output = rewriteM3u8(source, 'https://nas.local/live/index.m3u8', 'abc');
  assert.match(output, /xtmusic:\/\/hls\/abc\/proxy\?u=/);
  assert.ok(!output.includes('https://nas.local'));
});

test('base64url URL encoding round trips', () => {
  const url = 'https://nas.local:5667/path/file.m3u8?token=hidden';
  assert.equal(decodeBase64Url(encodeBase64Url(url)), url);
});
