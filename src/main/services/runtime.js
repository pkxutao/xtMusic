'use strict';

class Runtime {
  constructor() {
    this.client = null;
    this.account = null;
    this.mainWindow = null;
    this.tray = null;
    this.playerState = {
      playing: false,
      title: '',
      artist: '',
      canNext: false,
      canPrevious: false
    };
  }

  setSession(client, account) {
    this.client = client;
    this.account = account;
  }

  clearSession() {
    this.client = null;
    this.account = null;
  }

  requireClient() {
    if (!this.client) {
      const error = new Error('请先登录飞牛音乐');
      error.code = 'NOT_AUTHENTICATED';
      throw error;
    }
    return this.client;
  }
}

module.exports = { Runtime };
