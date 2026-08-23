'use strict';

const { FnDiscovery } = require('../protocol/fn-discovery');
const { FeiNiuClient } = require('../protocol/feiniu-client');
const { XtMusicError } = require('../protocol/errors');

class SessionService {
  constructor({ accountStore, runtime, transport }) {
    this.accountStore = accountStore;
    this.runtime = runtime;
    this.discovery = new FnDiscovery(transport);
    this.transport = transport;
  }

  async bootstrap() {
    const accounts = this.accountStore.list().sort((a, b) => b.lastUsedAt - a.lastUsedAt);
    const activeId = this.accountStore.activeId();
    let session = null;
    let sessionError = null;

    if (activeId) {
      const profile = this.accountStore.getProfile(activeId);
      const secret = this.accountStore.getSecret(activeId);
      if (profile && secret?.token) {
        const client = this.#clientFrom(profile, secret);
        try {
          const valid = await client.validateSession();
          if (valid) {
            this.runtime.setSession(client, profile);
            session = publicSession(profile);
          } else {
            this.accountStore.clearSession(activeId);
            sessionError = {
              code: 'SESSION_EXPIRED',
              message: '已保存的登录状态已失效，请重新输入密码'
            };
          }
        } catch (error) {
          // Do not destroy a saved session on transient network failure. The login
          // screen can offer the account and reconnect explicitly.
          sessionError = {
            code: error.code || 'RESTORE_FAILED',
            message: error.message
          };
        }
      }
    }

    return {
      session,
      sessionError,
      accounts: this.accountStore.list().sort((a, b) => b.lastUsedAt - a.lastUsedAt),
      activeId: session?.id || activeId,
      encryptionAvailable: this.accountStore.encryptionAvailable()
    };
  }

  async connect(payload, onProgress = () => {}) {
    validateLoginPayload(payload);
    const options = {
      allowHttp: Boolean(payload.allowHttp),
      allowPublicHttp: Boolean(payload.allowPublicHttp),
      allowSelfSigned: Boolean(payload.allowSelfSigned)
    };

    const connection = await this.discovery.resolve(
      payload.serverInput,
      options,
      onProgress
    );

    const deviceId = payload.deviceId || FeiNiuClient.generateDeviceId();
    const client = new FeiNiuClient(
      {
        serverUrl: connection.serverUrl,
        token: '',
        relayMode: connection.relayMode,
        accessCode: payload.accessCode || '',
        allowSelfSigned: options.allowSelfSigned,
        allowHttp: options.allowHttp,
        deviceId
      },
      this.transport
    );

    onProgress({ phase: 'access-code', message: '正在检查访问安全码…' });
    let accessCodeRequired = false;
    try {
      accessCodeRequired = await client.requiresAccessCode();
    } catch (error) {
      // Some older FNOS versions do not expose /access_code_verify.
      if (!['NETWORK_ERROR', 'TIMEOUT', 'CONNECTION_REFUSED'].includes(error.code)) {
        throw error;
      }
    }

    if (accessCodeRequired && !payload.accessCode) {
      throw new XtMusicError(
        'ACCESS_CODE_REQUIRED',
        '此飞牛地址启用了访问安全码，请输入后继续',
        { connection }
      );
    }
    if (accessCodeRequired && payload.accessCode) {
      const valid = await client.verifyAccessCode(payload.accessCode);
      if (!valid) throw new XtMusicError('INVALID_ACCESS_CODE', '访问安全码不正确');
    }

    onProgress({ phase: 'login', message: '正在验证飞牛账号…' });
    const result = await client.login(payload.username, payload.password);
    const profile = this.accountStore.saveAccount(
      {
        id: payload.accountId || null,
        name: payload.name || result.user.username,
        username: result.user.username,
        serverUrl: connection.serverUrl,
        fnId: connection.fnId,
        relayMode: connection.relayMode,
        allowSelfSigned: options.allowSelfSigned,
        allowHttp: options.allowHttp,
        deviceId
      },
      {
        token: result.token,
        accessCode: payload.accessCode || ''
      },
      { rememberSession: payload.rememberSession !== false }
    );

    this.runtime.setSession(client, profile);
    onProgress({ phase: 'ready', message: '音乐库连接成功' });
    return {
      session: publicSession(profile),
      accounts: this.accountStore.list(),
      connection: {
        ...connection,
        diagnostics: redactDiagnostics(connection.diagnostics)
      }
    };
  }

  async switchAccount(id) {
    const profile = this.accountStore.getProfile(String(id || ''));
    if (!profile) throw new XtMusicError('ACCOUNT_NOT_FOUND', '账号不存在');
    const secret = this.accountStore.getSecret(profile.id);
    if (!secret?.token) {
      throw new XtMusicError(
        'RELOGIN_REQUIRED',
        '此账号没有可恢复的会话，请重新输入密码',
        { profile }
      );
    }

    const client = this.#clientFrom(profile, secret);
    const valid = await client.validateSession();
    if (!valid) {
      this.accountStore.clearSession(profile.id);
      throw new XtMusicError(
        'SESSION_EXPIRED',
        '此账号的登录状态已失效，请重新输入密码',
        { profile }
      );
    }

    this.accountStore.setActive(profile.id);
    this.runtime.setSession(client, this.accountStore.getProfile(profile.id));
    return {
      session: publicSession(this.runtime.account),
      accounts: this.accountStore.list()
    };
  }

  logout({ clearSession = true } = {}) {
    const id = this.runtime.account?.id || this.accountStore.activeId();
    if (id && clearSession) this.accountStore.clearSession(id);
    this.accountStore.clearActive();
    this.runtime.clearSession();
    return {
      session: null,
      accounts: this.accountStore.list()
    };
  }

  removeAccount(id) {
    const accountId = String(id || '');
    if (this.runtime.account?.id === accountId) this.runtime.clearSession();
    this.accountStore.remove(accountId);
    return {
      session: this.runtime.account ? publicSession(this.runtime.account) : null,
      accounts: this.accountStore.list()
    };
  }

  listAccounts() {
    return this.accountStore.list();
  }

  #clientFrom(profile, secret) {
    return new FeiNiuClient(
      {
        serverUrl: profile.serverUrl,
        token: secret.token,
        relayMode: profile.relayMode,
        accessCode: secret.accessCode || '',
        allowSelfSigned: profile.allowSelfSigned,
        allowHttp: profile.allowHttp,
        deviceId: profile.deviceId
      },
      this.transport
    );
  }
}

function validateLoginPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new XtMusicError('INVALID_ARGUMENT', '登录参数不正确');
  }
  const serverInput = String(payload.serverInput || '').trim();
  const username = String(payload.username || '').trim();
  const password = String(payload.password || '');
  if (!serverInput || serverInput.length > 2048) {
    throw new XtMusicError('SERVER_REQUIRED', '请输入服务器地址或 FNID');
  }
  if (!username || username.length > 200) {
    throw new XtMusicError('USERNAME_REQUIRED', '请输入用户名');
  }
  if (!password || password.length > 1024) {
    throw new XtMusicError('PASSWORD_REQUIRED', '请输入密码');
  }
  if (payload.accessCode && String(payload.accessCode).length > 500) {
    throw new XtMusicError('INVALID_ACCESS_CODE', '访问安全码长度不正确');
  }
}

function publicSession(profile) {
  return {
    id: profile.id,
    name: profile.name,
    username: profile.username,
    serverUrl: profile.serverUrl,
    fnId: profile.fnId,
    relayMode: profile.relayMode,
    allowSelfSigned: profile.allowSelfSigned,
    allowHttp: profile.allowHttp,
    lastUsedAt: profile.lastUsedAt
  };
}

function redactDiagnostics(rows = []) {
  return rows.map((item) => ({
    url: item.url,
    label: item.label,
    group: item.group,
    reachable: item.reachable,
    elapsedMs: item.elapsedMs,
    error: item.error || null,
    errorCode: item.errorCode || null
  }));
}

module.exports = { SessionService, publicSession, validateLoginPayload };
