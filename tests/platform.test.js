'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getPlatformEnvironment,
  getSecureStorageStatus,
  normalizeWindowBounds
} = require('../src/main/platform');

test('Linux basic_text backend is never treated as secure persistence', () => {
  const status = getSecureStorageStatus({
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'basic_text'
  }, 'linux');

  assert.equal(status.available, true);
  assert.equal(status.secure, false);
  assert.equal(status.backend, 'basic_text');
  assert.match(status.reason, /Token 不会写入磁盘/);
});

test('GNOME libsecret is accepted for encrypted session persistence', () => {
  const status = getSecureStorageStatus({
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret'
  }, 'linux');

  assert.equal(status.secure, true);
  assert.equal(status.label, 'GNOME Keyring / libsecret');
  assert.equal(status.reason, null);
});

test('Wayland restores window size without absolute coordinates', () => {
  const environment = getPlatformEnvironment({
    platform: 'linux',
    env: { XDG_SESSION_TYPE: 'wayland', WAYLAND_DISPLAY: 'wayland-0' }
  });
  const bounds = normalizeWindowBounds({
    x: 220,
    y: 180,
    width: 1280,
    height: 760
  }, environment);

  assert.deepEqual(bounds, { width: 1280, height: 760 });
});

test('X11 restores visible window coordinates', () => {
  const environment = getPlatformEnvironment({
    platform: 'linux',
    env: { XDG_SESSION_TYPE: 'x11' }
  });
  const bounds = normalizeWindowBounds({
    x: 220,
    y: 180,
    width: 1280,
    height: 760
  }, environment);

  assert.deepEqual(bounds, { width: 1280, height: 760, x: 220, y: 180 });
});
