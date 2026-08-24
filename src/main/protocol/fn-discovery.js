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
    // An explicit HTTP(S) URL is an exact server address, not an FN ID.
    // Normalizing a URL first would turn https://<id>.fnos.net into <id>
    // and silently ignore the address the user entered.
    if (!input || /^https?:\/\//i.test(input)) return false;
    return isValidFnId(input);
  }

  async resolve(input, options = {}, onProgress = () => {}) {
    const value = String(input || '').trim();
    if (!value) throw new XtMusicError('SERVER_REQUIRED', '请输入服务器地址或 FN ID');

    if (!this.isFnId(value)) {
      const candidates = buildDirectCandidates(value, options);
      return this.#probeCandidates(candidates, options, onProgress);
    }

    const fnId = normalizeFnId(value);
    const fallbackCandidates = buildFnIdFallbackCandidates(fnId);
    let lookupError = null;
    let candidates = [...fallbackCandidates];

    onProgress({ phase: 'discovery', message: '正在查询 FN Connect 地址…' });
    try {
      const params = await this.fetchParams(fnId);
      candidates = dedupe([
        ...buildFnCandidates(fnId, params, options),
        ...fallbackCandidates
      ]).sort((a, b) => a.priority - b.priority);
    } catch (error) {
      lookupError = error;
      onProgress({
        phase: 'discovery-fallback',
        message: 'FN Connect 查询失败，正在尝试 FNOS 域名…'
      });
    }

    if (!candidates.length) {
      throw lookupError || new XtMusicError('NO_CANDIDATES', 'FN Connect 没有返回可用地址');
    }

    try {
      return await this.#probeCandidates(candidates, options, onProgress, fnId);
    } catch (error) {
      if (lookupError && error?.code === 'NO_REACHABLE_SERVER') {
        throw new XtMusicError(
          'FNID_CONNECT_FAILED',
          `FN ID 查询失败（${lookupError.message}），FNOS 域名也无法连接`,
          {
            lookupError: lookupError.message,
            diagnostics: error.details?.diagnostics || []
          }
        );
      }
      throw error;
    }
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
        payload.msg || 'FN ID 查询失败，请检查输入'
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
        candidates: group.map((item) => item.probeUrl || item.url)
      });
      const results = await Promise.all(
        group.map(async (candidate) => {
          const startedAt = Date.now();
          try {
            const probe = await probeOne(this.transport, candidate, options);
            return {
              ...candidate,
              ...probe,
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
        const serverUrl = normalizeServiceUrl(winner.url);
        onProgress({
          phase: 'connected',
          message: `已连接：${winner.label}`,
          candidate: serverUrl
        });
        return {
          serverUrl,
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
  const probeUrl = candidate.probeUrl || `${stripTrailingSlash(candidate.url)}/`;
  const response = await transport.requestBuffer(probeUrl, {
    method: 'GET',
    headers: candidate.relayMode ? { Cookie: 'mode=relay' } : {},
    timeoutMs: candidate.relayMode ? 10000 : 3500,
    allowHttp: probeUrl.startsWith('http://') && Boolean(options.allowHttp),
    allowSelfSigned: Boolean(options.allowSelfSigned),
    maxRedirects: 2,
    maxBytes: 256 * 1024
  });
  if (response.statusCode >= 500) {
    throw new XtMusicError('SERVER_UNAVAILABLE', `服务器返回 HTTP ${response.statusCode}`);
  }
  return { resolvedUrl: response.url || probeUrl };
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
    const relay = normalizeRelayUrl(raw);
    if (!relay) continue;
    const parsed = new URL(relay);
    rows.push({
      url: relay,
      relayMode: true,
      group: '中继',
      groupLabel: '中继',
      priority: 40,
      label: `FN Connect 中继 · ${parsed.host}`
    });
  }

  return dedupe(rows).sort((a, b) => a.priority - b.priority);
}

function buildFnIdFallbackCandidates(fnId) {
  const normalized = normalizeFnId(fnId);
  if (!isValidFnId(normalized)) return [];
  const encoded = encodeURIComponent(normalized);
  return [
    {
      url: `https://${normalized}.fnos.net`,
      probeUrl: `https://${normalized}.fnos.net/music/`,
      relayMode: true,
      group: 'FNOS 域名',
      groupLabel: 'FNOS 域名',
      priority: 35,
      label: `FN Connect 域名 · ${normalized}.fnos.net`
    },
    {
      url: `https://fnos.net/${encoded}`,
      probeUrl: `https://fnos.net/${encoded}/music/`,
      relayMode: true,
      group: 'FNOS 路径',
      groupLabel: 'FNOS 路径',
      priority: 36,
      label: `FN Connect 路径 · fnos.net/${normalized}`
    }
  ];
}

function buildDirectCandidates(input, options = {}) {
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new XtMusicError(
      'INVALID_URL',
      '服务器地址应以 http:// 或 https:// 开头；也可以直接输入 FN ID'
    );
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new XtMusicError('INVALID_URL', '服务器地址仅支持 HTTP 或 HTTPS');
  }
  if (parsed.protocol === 'http:' && !options.allowHttp) {
    throw new XtMusicError('HTTP_NOT_ALLOWED', '请勾选“允许 HTTP 直连”后再使用该地址');
  }

  const base = stripTrailingSlash(parsed.toString());
  const fnConnectHost = isFnConnectHost(parsed.hostname);
  const rows = [{
    url: base,
    probeUrl: `${base}/`,
    relayMode: fnConnectHost,
    group: '指定地址',
    groupLabel: '指定地址',
    priority: 0,
    label: `指定地址 · ${parsed.host}`
  }];

  if (!parsed.port && !fnConnectHost && parsed.pathname === '/') {
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
  const input = String(value || '').trim();
  if (!input) return '';

  try {
    const parsed = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    const host = parsed.hostname.toLowerCase();
    if (host.endsWith('.5ddd.com') || host.endsWith('.fnos.net')) {
      return host.split('.')[0];
    }
    if (host === '5ddd.com' || host === 'fnos.net') {
      return parsed.pathname.split('/').filter(Boolean)[0] || '';
    }
  } catch {
    // Fall through to plain-ID cleanup.
  }

  return input
    .replace(/^https?:\/\//i, '')
    .replace(/(?:\.5ddd\.com|\.fnos\.net)(?::\d+)?(?:\/.*)?$/i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function isValidFnId(value) {
  const id = String(value || '').trim();
  return id.length >= 1 && id.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(id);
}

function isFnConnectHost(host) {
  const lower = String(host || '').toLowerCase();
  return (
    lower === '5ddd.com' ||
    lower.endsWith('.5ddd.com') ||
    lower === 'fnos.net' ||
    lower.endsWith('.fnos.net')
  );
}

function normalizeServiceUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    throw new XtMusicError('INVALID_URL', '服务器地址格式不正确');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new XtMusicError('INVALID_URL', '服务器地址仅支持 HTTP/HTTPS');
  }

  parsed.search = '';
  parsed.hash = '';
  let pathname = parsed.pathname.replace(/\/{2,}/g, '/');
  pathname = pathname.replace(/\/music\/api\/v1(?:\/.*)?$/i, '');
  pathname = pathname.replace(/\/music\/?$/i, '');
  pathname = pathname.replace(/\/+$/, '');
  parsed.pathname = pathname || '/';
  return parsed.toString().replace(/\/+$/, '');
}

function normalizeRelayUrl(value) {
  const input = String(value || '').trim();
  if (!input) return null;
  try {
    const parsed = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    parsed.protocol = 'https:';
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return stripTrailingSlash(parsed.toString());
  } catch {
    return null;
  }
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
    const key = `${row.url}|${row.probeUrl || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
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
  buildFnIdFallbackCandidates,
  buildDirectCandidates,
  normalizeFnId,
  normalizeServiceUrl,
  normalizeParams,
  isValidFnId,
  isFnConnectHost,
  isPrivateHost,
  _constants: { AUTHX_PREFIX, API_KEY, FN_API_PATH, FN_API_URL }
};