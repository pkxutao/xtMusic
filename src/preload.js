'use strict';

const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, payload) {
  const result = await ipcRenderer.invoke(channel, payload);
  if (result?.ok) return result.data;
  const error = new Error(result?.error?.message || '操作失败');
  error.code = result?.error?.code || 'UNKNOWN';
  error.details = result?.error?.details || null;
  throw error;
}

const sessionType = String(process.env.XDG_SESSION_TYPE || '').toLowerCase();
const environment = Object.freeze({
  platform: process.platform,
  isLinux: process.platform === 'linux',
  isWayland: process.platform === 'linux' && (
    sessionType === 'wayland' || Boolean(process.env.WAYLAND_DISPLAY)
  ),
  sessionType
});

contextBridge.exposeInMainWorld('xtMusic', Object.freeze({
  environment,
  bootstrap: () => invoke('app:bootstrap'),
  auth: Object.freeze({
    connect: (payload) => invoke('auth:connect', payload),
    switchAccount: (id) => invoke('auth:switch', id),
    logout: (options) => invoke('auth:logout', options),
    removeAccount: (id) => invoke('auth:remove', id),
    listAccounts: () => invoke('auth:list')
  }),
  music: Object.freeze({
    call: (method, args = {}) => invoke('music:call', { method, args })
  }),
  settings: Object.freeze({
    get: () => invoke('settings:get'),
    set: (key, value) => invoke('settings:set', { key, value })
  }),
  cache: Object.freeze({
    clear: () => invoke('cache:clear')
  }),
  window: Object.freeze({
    minimize: () => invoke('window:minimize'),
    toggleMaximize: () => invoke('window:toggleMaximize'),
    close: () => invoke('window:close'),
    isMaximized: () => invoke('window:isMaximized')
  }),
  player: Object.freeze({
    publishState: (state) => ipcRenderer.send('player:state', state)
  }),
  events: Object.freeze({
    onAuthProgress: (listener) => subscribe('auth:progress', listener),
    onPlayerCommand: (listener) => subscribe('player:command', listener),
    onWindowMaximized: (listener) => subscribe('window:maximized', listener),
    onSystemTheme: (listener) => subscribe('theme:system', listener)
  })
}));

function subscribe(channel, listener) {
  if (typeof listener !== 'function') return () => {};
  const handler = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
