// IndexedDB stores full library snapshots asynchronously, separately from small
// transport state. localStorage's old 500-track queue is intentionally not
// migrated: it has no account identity and cannot safely be assigned to a user.
export class PlaybackStorage {
  constructor(factory = globalThis.indexedDB) { this.factory = factory; this.opening = null; }

  open() {
    if (!this.opening) this.opening = new Promise((resolve, reject) => {
      if (!this.factory) { reject(new Error('当前环境不支持播放记录存储')); return; }
      const request = this.factory.open('xtmusic.playback.v2', 1);
      request.onupgradeneeded = () => {
        for (const name of ['queues', 'states', 'progress', 'libraries']) request.result.createObjectStore(name);
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); this.opening = null; };
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('播放记录数据库被其他窗口占用'));
    }).catch((error) => { this.opening = null; throw error; });
    return this.opening;
  }

  async transaction(names, mode, execute) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let result;
      tx.oncomplete = () => resolve(result?.());
      tx.onabort = tx.onerror = () => reject(tx.error || new Error('无法保存播放记录'));
      try { result = execute(tx); } catch (error) { tx.abort(); reject(error); }
    });
  }

  async load(scope) {
    return this.transaction(['queues', 'states', 'progress'], 'readonly', (tx) => {
      const queue = tx.objectStore('queues').get(scope);
      const state = tx.objectStore('states').get(scope);
      const progress = tx.objectStore('progress').get(scope);
      return () => ({ queue: queue.result, state: state.result, progress: progress.result });
    });
  }

  save(scope, state, queue = null) {
    return this.transaction(['queues', 'states', 'progress'], 'readwrite', (tx) => {
      if (queue) {
        tx.objectStore('queues').put(queue, scope);
        tx.objectStore('progress').delete(scope);
      }
      tx.objectStore('states').put(state, scope);
    });
  }

  saveProgress(scope, progress) {
    return this.transaction(['progress'], 'readwrite', (tx) => { tx.objectStore('progress').put(progress, scope); });
  }

  library(scope, key, value = null) {
    return this.transaction(['libraries'], value ? 'readwrite' : 'readonly', (tx) => {
      const store = tx.objectStore('libraries');
      if (value) { store.put(value, [scope, key]); return; }
      const request = store.get([scope, key]);
      return () => request.result;
    });
  }

  async removeAccount(scope) {
    await this.clearLibraries(scope);
    await this.transaction(['queues', 'states', 'progress'], 'readwrite', (tx) => {
      for (const name of ['queues', 'states', 'progress']) tx.objectStore(name).delete(scope);
    });
  }

  clearLibraries(scope) {
    return this.transaction(['libraries'], 'readwrite', (tx) => {
      const request = tx.objectStore('libraries').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (cursor.key[0] === scope) cursor.delete();
        cursor.continue();
      };
    });
  }
}
