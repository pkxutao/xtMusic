'use strict';

const path = require('node:path');

function getPlatformEnvironment({
  platform = process.platform,
  env = process.env
} = {}) {
  const sessionType = String(env.XDG_SESSION_TYPE || '').toLowerCase();
  const desktop = String(env.XDG_CURRENT_DESKTOP || env.DESKTOP_SESSION || '');
  const isLinux = platform === 'linux';
  const isWayland = isLinux && (
    sessionType === 'wayland' || Boolean(env.WAYLAND_DISPLAY)
  );

  return {
    platform,
    isLinux,
    isWayland,
    sessionType,
    desktop,
    nativeFrame: isLinux
  };
}

function getAppIconPath() {
  return process.platform === 'linux'
    ? path.join(__dirname, '../../assets/app-icon.png')
    : path.join(__dirname, '../../build/icon.ico');
}

function getTrayIconPath() {
  return path.join(__dirname, '../../assets/tray.png');
}

function normalizeWindowBounds(bounds, platformEnvironment = getPlatformEnvironment()) {
  const normalized = {
    width: Math.max(1024, Math.round(bounds?.width || 1440)),
    height: Math.max(680, Math.round(bounds?.height || 860))
  };

  if (!platformEnvironment.isWayland) {
    if (Number.isFinite(bounds?.x)) normalized.x = Math.round(bounds.x);
    if (Number.isFinite(bounds?.y)) normalized.y = Math.round(bounds.y);
  }

  return normalized;
}

function getSecureStorageStatus(safeStorage, platform = process.platform) {
  let available = false;
  try {
    available = Boolean(safeStorage?.isEncryptionAvailable?.());
  } catch {
    available = false;
  }

  let backend = 'unknown';
  if (platform === 'win32') backend = 'dpapi';
  else if (platform === 'darwin') backend = 'keychain';
  else if (platform === 'linux') {
    try {
      backend = String(safeStorage?.getSelectedStorageBackend?.() || 'unknown');
    } catch {
      backend = 'unknown';
    }
  }

  const secure = available && (
    platform !== 'linux' || !['basic_text', 'unknown'].includes(backend)
  );

  const labels = {
    dpapi: 'Windows DPAPI',
    keychain: 'macOS Keychain',
    gnome_libsecret: 'GNOME Keyring / libsecret',
    kwallet: 'KWallet',
    kwallet5: 'KWallet 5',
    kwallet6: 'KWallet 6',
    basic_text: '不安全的 basic_text 后端',
    unknown: '未知后端'
  };

  let reason = null;
  if (!available) {
    reason = '操作系统安全存储当前不可用，会话仅保存在本次运行中。';
  } else if (platform === 'linux' && backend === 'basic_text') {
    reason = '未检测到 GNOME Keyring、libsecret 或 KWallet；为避免弱加密，Token 不会写入磁盘。';
  } else if (platform === 'linux' && backend === 'unknown') {
    reason = '尚未识别 Linux 密钥环后端；Token 不会写入磁盘。';
  }

  return {
    available,
    secure,
    backend,
    label: labels[backend] || backend,
    reason
  };
}

module.exports = {
  getPlatformEnvironment,
  getAppIconPath,
  getTrayIconPath,
  normalizeWindowBounds,
  getSecureStorageStatus
};
