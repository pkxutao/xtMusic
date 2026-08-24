'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { safeStorage } = require('electron');
const { JsonStore } = require('./json-store');
const { getSecureStorageStatus } = require('../platform');

class SecureAccountStore {
  constructor(userDataPath) {
    this.store = new JsonStore(path.join(userDataPath, 'accounts.json'), {
      version: 1,
      activeId: null,
      accounts: []
    });
    this.ephemeralSecrets = new Map();
  }

  storageStatus() {
    return getSecureStorageStatus(safeStorage);
  }

  encryptionAvailable() {
    return this.storageStatus().secure;
  }

  list() {
    const secureStorageAvailable = this.encryptionAvailable();
    return this.store.get('accounts', []).map(({ secret, ...profile }) => ({
      ...profile,
      hasSession: (secureStorageAvailable && Boolean(secret)) || this.ephemeralSecrets.has(profile.id)
    }));
  }

  activeId() {
    return this.store.get('activeId', null);
  }

  getProfile(id) {
    const row = this.store.get('accounts', []).find((item) => item.id === id);
    if (!row) return null;
    const { secret, ...profile } = row;
    return {
      ...profile,
      hasSession: (this.encryptionAvailable() && Boolean(secret)) || this.ephemeralSecrets.has(id)
    };
  }

  getActiveProfile() {
    const id = this.activeId();
    return id ? this.getProfile(id) : null;
  }

  getSecret(id) {
    if (this.ephemeralSecrets.has(id)) {
      return structuredClone(this.ephemeralSecrets.get(id));
    }

    const row = this.store.get('accounts', []).find((item) => item.id === id);
    if (!row?.secret || !this.encryptionAvailable()) return null;

    try {
      const decrypted = safeStorage.decryptString(Buffer.from(row.secret, 'base64'));
      return JSON.parse(decrypted);
    } catch {
      return null;
    }
  }

  saveAccount(profile, secret, { rememberSession = true } = {}) {
    const accounts = this.store.get('accounts', []);
    const now = Date.now();
    const id = profile.id || crypto.randomUUID();
    const existing = accounts.find((item) => item.id === id);
    const normalized = {
      id,
      name: String(profile.name || profile.username || '飞牛音乐').slice(0, 80),
      username: String(profile.username || '').slice(0, 200),
      serverUrl: String(profile.serverUrl || '').slice(0, 2048),
      fnId: profile.fnId ? String(profile.fnId).slice(0, 200) : null,
      relayMode: Boolean(profile.relayMode),
      allowSelfSigned: Boolean(profile.allowSelfSigned),
      allowHttp: Boolean(profile.allowHttp),
      deviceId: profile.deviceId || existing?.deviceId || crypto.randomBytes(16).toString('hex'),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      lastUsedAt: now,
      secret: existing?.secret || null
    };

    if (secret) {
      if (rememberSession && this.encryptionAvailable()) {
        normalized.secret = safeStorage
          .encryptString(JSON.stringify(secret))
          .toString('base64');
        this.ephemeralSecrets.delete(id);
      } else {
        normalized.secret = null;
        this.ephemeralSecrets.set(id, structuredClone(secret));
      }
    }

    const next = accounts.filter((item) => item.id !== id);
    next.push(normalized);
    this.store.patch({ accounts: next, activeId: id });
    return this.getProfile(id);
  }

  touch(id) {
    const accounts = this.store.get('accounts', []);
    const index = accounts.findIndex((item) => item.id === id);
    if (index < 0) return;
    accounts[index].lastUsedAt = Date.now();
    accounts[index].updatedAt = Date.now();
    this.store.patch({ accounts, activeId: id });
  }

  setActive(id) {
    if (!this.getProfile(id)) throw new Error('账号不存在');
    this.store.set('activeId', id);
    this.touch(id);
  }

  clearSession(id) {
    const accounts = this.store.get('accounts', []);
    const row = accounts.find((item) => item.id === id);
    if (row) row.secret = null;
    this.ephemeralSecrets.delete(id);
    this.store.patch({ accounts });
  }

  remove(id) {
    const accounts = this.store.get('accounts', []).filter((item) => item.id !== id);
    this.ephemeralSecrets.delete(id);
    const activeId = this.activeId() === id ? null : this.activeId();
    this.store.patch({ accounts, activeId });
  }

  clearActive() {
    this.store.set('activeId', null);
  }
}

module.exports = { SecureAccountStore };
