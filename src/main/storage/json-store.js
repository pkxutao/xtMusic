'use strict';

const fs = require('node:fs');
const path = require('node:path');

class JsonStore {
  constructor(filePath, defaults = {}) {
    this.filePath = filePath;
    this.defaults = structuredClone(defaults);
    this.data = this.#read();
  }

  #read() {
    try {
      const value = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return { ...structuredClone(this.defaults), ...value };
    } catch {
      return structuredClone(this.defaults);
    }
  }

  get(key, fallback) {
    return Object.prototype.hasOwnProperty.call(this.data, key)
      ? this.data[key]
      : fallback;
  }

  set(key, value) {
    this.data[key] = value;
    this.flush();
  }

  patch(value) {
    this.data = { ...this.data, ...value };
    this.flush();
  }

  delete(key) {
    delete this.data[key];
    this.flush();
  }

  flush() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.filePath);
  }
}

module.exports = { JsonStore };
