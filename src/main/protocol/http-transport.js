'use strict';

const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { XtMusicError } = require('./errors');

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-access-code',
  'x-access-source'
]);

class HttpTransport {
  async requestBuffer(url, options = {}) {
    const response = await this.requestStream(url, options);
    const chunks = [];
    let size = 0;
    const maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
    for await (const chunk of response.stream) {
      size += chunk.length;
      if (size > maxBytes) {
        response.stream.destroy();
        throw new XtMusicError('RESPONSE_TOO_LARGE', '服务器响应过大');
      }
      chunks.push(chunk);
    }
    return { ...response, body: Buffer.concat(chunks) };
  }

  async requestJson(url, options = {}) {
    const response = await this.requestBuffer(url, {
      ...options,
      maxBytes: options.maxBytes ?? 8 * 1024 * 1024
    });
    const text = response.body.toString('utf8').replace(/^\uFEFF/, '');
    let data = null;
    if (text.trim()) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new XtMusicError(
          'INVALID_JSON',
          `服务器返回了无法解析的数据（HTTP ${response.statusCode}）`,
          { preview: text.slice(0, 300) }
        );
      }
    }
    return { ...response, data, text };
  }

  requestStream(rawUrl, options = {}, redirectDepth = 0) {
    const {
      method = 'GET',
      headers = {},
      body = null,
      timeoutMs = 15000,
      allowHttp = false,
      allowSelfSigned = false,
      maxRedirects = 5,
      trustedRedirect = defaultTrustedRedirect
    } = options;

    let target;
    try {
      target = new URL(rawUrl);
    } catch {
      return Promise.reject(new XtMusicError('INVALID_URL', '服务器地址格式不正确'));
    }

    if (!['http:', 'https:'].includes(target.protocol)) {
      return Promise.reject(new XtMusicError('UNSUPPORTED_PROTOCOL', '仅支持 HTTP/HTTPS 地址'));
    }
    if (target.protocol === 'http:' && !allowHttp) {
      return Promise.reject(
        new XtMusicError('HTTP_NOT_ALLOWED', '该连接使用未加密 HTTP，请在登录页明确允许后重试')
      );
    }

    const requestBody = normalizeBody(body, headers);
    const requestHeaders = normalizeHeaders(headers);
    if (requestBody && !hasHeader(requestHeaders, 'content-length')) {
      requestHeaders['Content-Length'] = String(requestBody.length);
    }

    return new Promise((resolve, reject) => {
      const isHttps = target.protocol === 'https:';
      const requestFn = isHttps ? https.request : http.request;
      let settled = false;

      const req = requestFn(
        {
          protocol: target.protocol,
          hostname: target.hostname,
          port: target.port || undefined,
          method,
          path: `${target.pathname}${target.search}`,
          headers: requestHeaders,
          rejectUnauthorized: isHttps ? !allowSelfSigned : undefined,
          servername: isHttps && !net.isIP(target.hostname) ? target.hostname : undefined,
          agent: false
        },
        (res) => {
          const statusCode = res.statusCode || 0;
          const location = res.headers.location;
          if (
            location &&
            statusCode >= 300 &&
            statusCode < 400 &&
            redirectDepth < maxRedirects
          ) {
            const next = new URL(location, target);
            const safe = target.origin === next.origin || trustedRedirect(target, next);
            const nextHeaders = { ...requestHeaders };
            if (!safe) {
              for (const name of Object.keys(nextHeaders)) {
                if (SENSITIVE_HEADERS.has(name.toLowerCase())) delete nextHeaders[name];
              }
            }
            if (target.protocol === 'https:' && next.protocol === 'http:' && !allowHttp) {
              res.resume();
              settled = true;
              reject(
                new XtMusicError(
                  'INSECURE_REDIRECT',
                  '服务器尝试把 HTTPS 请求降级为 HTTP，已阻止'
                )
              );
              return;
            }
            const nextMethod = statusCode === 303 ? 'GET' : method;
            const nextBody = nextMethod === 'GET' ? null : body;
            res.resume();
            settled = true;
            this.requestStream(
              next.toString(),
              {
                ...options,
                method: nextMethod,
                body: nextBody,
                headers: nextHeaders
              },
              redirectDepth + 1
            ).then(resolve, reject);
            return;
          }

          settled = true;
          resolve({
            statusCode,
            statusMessage: res.statusMessage || '',
            headers: res.headers,
            stream: res,
            url: target.toString()
          });
        }
      );

      req.on('error', (error) => {
        if (settled) return;
        settled = true;
        reject(mapNetworkError(error, target));
      });

      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('XT_TIMEOUT'));
      });

      if (requestBody) req.write(requestBody);
      req.end();
    });
  }
}

function normalizeBody(body, headers) {
  if (body == null) return null;
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (!hasHeader(headers, 'content-type')) {
    headers['Content-Type'] = 'application/json; charset=utf-8';
  }
  return Buffer.from(JSON.stringify(body));
}

function normalizeHeaders(headers) {
  const result = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (value == null) continue;
    result[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  if (!hasHeader(result, 'user-agent')) {
    result['User-Agent'] = 'XT-Music/0.1 Windows';
  }
  if (!hasHeader(result, 'accept')) result.Accept = 'application/json, */*';
  return result;
}

function hasHeader(headers, name) {
  return Object.keys(headers || {}).some((key) => key.toLowerCase() === name.toLowerCase());
}

function defaultTrustedRedirect(from, to) {
  const a = from.hostname.toLowerCase();
  const b = to.hostname.toLowerCase();
  return (
    from.protocol === 'https:' &&
    to.protocol === 'https:' &&
    a.endsWith('.5ddd.com') &&
    b.endsWith('.5ddd.com')
  );
}

function mapNetworkError(error, target) {
  const text = String(error?.message || error);
  let code = 'NETWORK_ERROR';
  let message = `无法连接 ${target.host}`;
  if (text.includes('XT_TIMEOUT') || /timed?\s*out/i.test(text)) {
    code = 'TIMEOUT';
    message = `连接 ${target.host} 超时`;
  } else if (/ECONNREFUSED|connection refused/i.test(text)) {
    code = 'CONNECTION_REFUSED';
    message = `${target.host} 拒绝连接，请检查端口和音乐服务`;
  } else if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text)) {
    code = 'DNS_ERROR';
    message = `无法解析主机 ${target.hostname}`;
  } else if (/certificate|self[- ]signed|unable to verify|CERT_/i.test(text)) {
    code = 'CERTIFICATE_ERROR';
    message = 'HTTPS 证书校验失败；仅在确认这是你的 NAS 后，才启用“信任自签名证书”';
  } else if (/ENETUNREACH|EHOSTUNREACH|network is unreachable/i.test(text)) {
    code = 'NETWORK_UNREACHABLE';
    message = `当前网络无法到达 ${target.host}`;
  }
  return new XtMusicError(code, message, { cause: text, target: target.toString() });
}

module.exports = {
  HttpTransport,
  defaultTrustedRedirect,
  mapNetworkError,
  _internals: { normalizeBody, normalizeHeaders, hasHeader }
};
