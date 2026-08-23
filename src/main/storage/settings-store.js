'use strict';

const path = require('node:path');
const { JsonStore } = require('./json-store');

const DEFAULTS = {
  theme: 'dark',
  closeToTray: true,
  volume: 0.82,
  repeatMode: 'off',
  queuePanelOpen: false,
  windowBounds: null,
  lastRoute: 'home'
};

class SettingsStore {
  constructor(userDataPath) {
    this.store = new JsonStore(path.join(userDataPath, 'settings.json'), DEFAULTS);
  }

  all() {
    return { ...DEFAULTS, ...this.store.data };
  }

  get(key) {
    return this.store.get(key, DEFAULTS[key]);
  }

  set(key, value) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
      throw new Error(`未知设置项: ${key}`);
    }
    const sanitized = sanitize(key, value);
    this.store.set(key, sanitized);
    return sanitized;
  }
}

function sanitize(key, value) {
  switch (key) {
    case 'theme':
      return ['dark', 'light', 'system'].includes(value) ? value : 'dark';
    case 'closeToTray':
    case 'queuePanelOpen':
      return Boolean(value);
    case 'volume':
      return Math.max(0, Math.min(1, Number(value) || 0));
    case 'repeatMode':
      return ['off', 'all', 'one'].includes(value) ? value : 'off';
    case 'windowBounds':
      if (!value || typeof value !== 'object') return null;
      return {
        x: Number.isFinite(value.x) ? Math.round(value.x) : undefined,
        y: Number.isFinite(value.y) ? Math.round(value.y) : undefined,
        width: Math.max(960, Math.round(value.width || 1440)),
        height: Math.max(640, Math.round(value.height || 860))
      };
    case 'lastRoute':
      return String(value || 'home').slice(0, 100);
    default:
      return value;
  }
}

module.exports = { SettingsStore, DEFAULTS };
