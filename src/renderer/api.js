export const bridge = window.xtMusic;

export const api = {
  bootstrap: () => bridge.bootstrap(),
  connect: (payload) => bridge.auth.connect(payload),
  switchAccount: (id) => bridge.auth.switchAccount(id),
  logout: (options = {}) => bridge.auth.logout(options),
  removeAccount: (id) => bridge.auth.removeAccount(id),
  listAccounts: () => bridge.auth.listAccounts(),
  music: (method, args = {}) => bridge.music.call(method, args),
  settings: () => bridge.settings.get(),
  setSetting: (key, value) => bridge.settings.set(key, value),
  clearCache: () => bridge.cache.clear()
};
