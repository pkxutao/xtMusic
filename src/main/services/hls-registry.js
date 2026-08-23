'use strict';

const crypto = require('node:crypto');

class HlsRegistry {
  constructor() {
    this.entries = new Map();
  }

  register(guid, sourceUrl) {
    const key = crypto
      .createHash('sha256')
      .update(`${guid}:${sourceUrl}:${Date.now()}`)
      .digest('hex')
      .slice(0, 24);
    this.entries.set(key, {
      guid,
      sourceUrl,
      createdAt: Date.now()
    });
    this.cleanup();
    return key;
  }

  get(key) {
    return this.entries.get(key) || null;
  }

  removeByGuid(guid) {
    for (const [key, entry] of this.entries) {
      if (entry.guid === guid) this.entries.delete(key);
    }
  }

  cleanup(maxAgeMs = 6 * 60 * 60 * 1000) {
    const cutoff = Date.now() - maxAgeMs;
    for (const [key, entry] of this.entries) {
      if (entry.createdAt < cutoff) this.entries.delete(key);
    }
  }
}

module.exports = { HlsRegistry };
