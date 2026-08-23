'use strict';

const crypto = require('node:crypto');
const net = require('node:net');
const { HttpTransport } = require('./http-transport');
const { XtMusicError } = require('./errors');

const AUTHX_PREFIX = 'NDzZTVxnRKP8Z0jXg1VAMonaG8akvh';
const API_KEY = 'zIGtkc3dqZnJpd29qZXJqa2w7c';
const FN_API_PATH = '/api/v1/fn/con';
const FN_API_URL = `https://5ddd.com${FN_API_PATH}`;

class FnDiscovery {
  constructor(transport = new HttpTransport()) {
    this.transport = transport;
  }

  isFnId(value) {
    const input = String(value || '').trim();
    return Boolean(input) && !/^https?:\/\//i.test(input) && input.length >= 6;
  }

  async resolve(input, options = {}, onProgress = () => {}) {
    const value = String(input || '').trim();
    if (!value) throw new XtMusicError('SERVER_REQUIRED', '请输入服务器地址或 FNID');

    if (!this.isFnId(value)) {
      const candidates = buildDirectCandidates(value, options);
      return this.#probeCandidates(candidates, options, onProgress);
    }

    onProgress({ phase: 'discovery', message: '正在查询 FN Connect 地址…' });
    const params = await this.fetchParams(value);
    const candidates = buildFnCandidates(value, params, options);
    if (!candidates.length) {
      throw new XtMusicError('NO_CANDIDATES', 'FN Connect 没有返回可用地址');
    }
    return this.#probeCandidates(candidates, options, onProgress, value);
  }

  async fetchParams(fnId) {
    const data = { fnId: normalizeFnId(fnId) };
    const authx = computeAuthx('post', FN_API_PATH, data);
    const response = await this.transport.requestJson(FN_API_URL, {
      method: 'POST',
      headers: { authx },
      body: data,
      timeoutMs: 10000,
      allowHttp: false,
      allowSelfSigned: false
    });
    const payload = response.data || {};
    if (payload.code !== 0 || !payload.data) {
      throw new XtMusicError(
        'FNID_LOOKUP_FAILED',
        payload.msg || 'FNID 查询失败，请检查输入'
      );
    }
    return normalizeParams(payload.data);
  }

  async #probeCandidates(candidates, options, onProgress, fnId = null) {
    const diagnostics = [];
    const groups = groupByPriority(candidates);
    for (const group of groups) {
      onProgress({
        phase: 'probe',
        message: `正在探测${group[0].groupLabel}链路…`,
        candidates: group.map((item) => item.url)
      });
      const results = await Promise.all(
        group.map(async (candidate) => {
          const startedAt = Date.now();
          try {
            await probeOne(this.transport, candidate, options);
            return {
              ...candidate,
              reachable: true,
              elapsedMs: Date.now() - startedAt,
              error: null
            };
          } catch (error) {
            return {
              ...candidate,
              reachable: false,
              elapsedMs: Date.now() - startedAt,
              error: error.message,
              errorCode: error.code || 'NETWORK_ERROR'
            };
          }
        })
      );
      diagnostics.push(...results);
      const winner = results.find((item) => item.reachable);
      if (winner) {
        onProgress({
          phase: 'connected',
          message: `已连接：${winner.label}`,
          candidate: winner.url
        });
        return {
          serverUrl: stripTrailingSlash(winner.url),
          relayMode: winner.relayMode,
          method: winner.label,
          fnId,
          diagnostics
        };
      }
    }
    throw new XtMusicError(
      'NO_REACHABLE_SERVER',
      '没有找到可连接的飞牛音乐服务',
      { diagnostics }
    );
  }
}

async function probeOne(transport, candidate, options) {
  const response = await transport.requestBuffer(`${stripTrailingSlash(candidate.url)}/`, {
    method: 'GET',
    headers: candidate.relayMode ? { Cookie: 'mode=relay' } : {},
    timeoutMs: candidate.relayMode ? 10000 : 3500,
    allowHttp: candidate.url.startsWith('http://') && Boolean(options.allowHttp),
    allowSelfSigned: Boolean(options.allowSelfSigned),
    maxRedirects: 2,
    maxBytes: 256 * 1024
  });
  if (response.statusCode >= 500) {
    throw new XtMusicError('SERVER_UNAVAILABLE', `服务器返回 HTTP ${response.statusCode}`);
  }
}

function buildFnCandidates(fnId, params, options = {}) {
  const rows = [];
  const allowHttp = Boolean(options.allowHttp);
  const allowPublicHttp = Boolean(options.allowPublicHttp);
  const addIp = (ip, group, priority, isV6 = false, isPublic = false) => {
    const host = isV6 ? `[${ip}]` : ip;
    rows.push({
      url: `https://${host}:${params.httpsPort}`,
      relayMode: false,
      group,
      groupLabel: group,
      priority,
      label: `${group} HTTPS · ${ip}:${params.httpsPort}`
    });
    if (allowHttp && (!isPublic || allowPublicHttp || isPrivateHost(ip))) {
      rows.push({
        url: `http://${host}:${params.httpPort}`,
        relayMode: false,
        group,
        groupLabel: group,
        priority: priority + 1,
        label: `${group} HTTP · ${ip}:${params.httpPort}`
      });
    }
  };

  for (const ip of params.internalIPv4s) addIp(ip, '内网', 10, false, false);
  for (const ip of params.publicIPv6s) addIp(ip, '公网 IPv6', 20, true, true);
  for (const ip of params.publicIPv4s) addIp(ip, '公网 IPv4', 30, false, true);

  const relayAddresses = params.relayAddresses.length
    ? params.relayAddresses
    : [`${normalizeFnId(fnId)}.5ddd.com`];
  for (const raw of relayAddresses) {
    const withoutScheme = raw.replace(/^https?:\/\//i, '');
    const host = withoutScheme.replace(/:\d+$/, '');
    rows.push({
      url: `https://${host}`,
      relayMode: true,
      group: '中继',
      groupLabel: '中继',
      priority: 40,
      label: `FN Connect 中继 · ${host}`
    });
  }

  return dedupe(rows).sort((a, b) => a.priority - b.priority);
}

function buildDirectCandidates(input, options = {}) {
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new XtMusicError(
      'INVALID_URL',
      '服务器地址应以 http:// 或 https:// 开头；也可以直接输入 FNID'
    );
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new XtMusicError('INVALID_URL', '服务器地址仅支持 HTTP 或 HTTPS');
  }
  if (parsed.protocol === 'http:' && !options.allowHttp) {
    throw new XtMusicError('HTTP_NOT_ALLOWED', '请勾选“允许 HTTP 直连”后再使用该地址');
  }

  const base = stripTrailingSlash(parsed.toString());
  const rows = [{
    url: base,
    relayMode: parsed.hostname.endsWith('.5ddd.com'),
    group: '指定地址',
    groupLabel: '指定地址',
    priority: 0,
    label: `指定地址 · ${parsed.host}`
  }];

  if (!parsed.port) {
    const host = parsed.hostname.includes(':') ? `[${parsed.hostname}]` : parsed.hostname;
    if (parsed.protocol === 'https:') {
      rows.push({
        url: `https://${host}:5667`,
        relayMode: false,
        group: '默认端口',
        groupLabel: '默认端口',
        priority: 1,
        label: `HTTPS 默认端口 · ${host}:5667`
      });
    } else if (options.allowHttp) {
      rows.push({
        url: `http://${host}:5666`,
        relayMode: false,
        group: '默认端口',
        groupLabel: '默认端口',
        priority: 1,
        label: `HTTP 默认端口 · ${host}:5666`
      });
    }
  }
  return dedupe(rows);
}

function normalizeParams(value) {
  const ports = value.port || {};
  return {
    internalIPv4s: stringArray(value.ipv4),
    publicIPv4s: stringArray(value.publicIpv4),
    publicIPv6s: stringArray(value.publicIpv6),
    httpsPort: positiveInt(ports.httpsPort, 5667),
    httpPort: positiveInt(ports.httpPort, 5666),
    relayAddresses: stringArray(value.fn)
  };
}

function computeAuthx(method, path, data, overrides = {}) {
  const serialized = method.toLowerCase() === 'get'
    ? sortQuery(data)
    : JSON.stringify(data ?? {});
  const nonce = overrides.nonce || String(Math.floor(Math.random() * 900000) + 100000);
  const timestamp = overrides.timestamp || String(Date.now());
  const raw = [
    AUTHX_PREFIX,
    path,
    nonce,
    timestamp,
    md5(serialized),
    API_KEY
  ].join('_');
  return `nonce=${nonce}&timestamp=${timestamp}&sign=${md5(raw)}`;
}

function sortQuery(params = {}) {
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${encodeURIComponent(String(params[key]))}`)
    .join('&');
}

function md5(value) {
  return crypto.createHash('md5').update(String(value)).digest('hex');
}

function normalizeFnId(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\.5ddd\.com(?::\d+)?\/?$/i, '')
    .replace(/\/+$/, '');
}

function isPrivateHost(host) {
  if (!host) return false;
  if (net.isIPv4(host)) {
    const p = host.split('.').map(Number);
    return (
      p[0] === 10 ||
      p[0] === 127 ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 169 && p[1] === 254)
    );
  }
  const lower = host.toLowerCase();
  return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
}

function groupByPriority(rows) {
  const groups = [];
  for (const row of rows) {
    const existing = groups.find((group) => group[0].group === row.group);
    if (existing) existing.push(row);
    else groups.push([row]);
  }
  return groups;
}

function dedupe(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    if (seen.has(row.url)) return false;
    seen.add(row.url);
    return true;
  });
}

function stringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : [];
}

function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/, '');
}

module.exports = {
  FnDiscovery,
  computeAuthx,
  buildFnCandidates,
  buildDirectCandidates,
  normalizeFnId,
  normalizeParams,
  isPrivateHost,
  _constants: { AUTHX_PREFIX, API_KEY, FN_API_PATH, FN_API_URL }
};
