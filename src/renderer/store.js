export class Store extends EventTarget {
  constructor(initial = {}) {
    super();
    this.state = {
      bootstrapping: true,
      session: null,
      accounts: [],
      settings: {},
      route: { name: 'home', params: {} },
      history: [],
      historyIndex: -1,
      loading: false,
      error: null,
      playlists: [],
      playlistTotal: 0,
      searchQuery: '',
      searchOpen: false,
      queueOpen: false,
      connectionDiagnostics: [],
      ...initial
    };
  }

  get() {
    return this.state;
  }

  set(patch, source = 'set') {
    this.state = { ...this.state, ...patch };
    this.dispatchEvent(new CustomEvent('change', { detail: { patch, source } }));
  }

  update(updater, source = 'update') {
    this.set(updater(this.state), source);
  }

  navigate(name, params = {}, { replace = false, silent = false } = {}) {
    const route = { name, params };
    const history = this.state.history.slice(0, this.state.historyIndex + 1);
    let historyIndex = this.state.historyIndex;
    if (replace && history.length) {
      history[history.length - 1] = route;
      historyIndex = history.length - 1;
    } else {
      history.push(route);
      historyIndex = history.length - 1;
    }
    this.set({ route, history, historyIndex, searchOpen: false }, 'navigate');
    if (!silent) {
      window.xtMusic.settings.set('lastRoute', name).catch(() => {});
    }
  }

  back() {
    if (this.state.historyIndex <= 0) return null;
    const historyIndex = this.state.historyIndex - 1;
    const route = this.state.history[historyIndex];
    this.set({ historyIndex, route, searchOpen: false }, 'history');
    return route;
  }

  forward() {
    if (this.state.historyIndex >= this.state.history.length - 1) return null;
    const historyIndex = this.state.historyIndex + 1;
    const route = this.state.history[historyIndex];
    this.set({ historyIndex, route, searchOpen: false }, 'history');
    return route;
  }
}
