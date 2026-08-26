'use strict';

const path = require('node:path');
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  Notification,
  clipboard,
  globalShortcut,
  nativeImage,
  nativeTheme,
  protocol,
  screen,
  shell
} = require('electron');
const { Diagnostics } = require('./diagnostics');
const { HttpTransport } = require('./protocol/http-transport');
const { SecureAccountStore } = require('./storage/secure-store');
const { SettingsStore } = require('./storage/settings-store');
const { SessionService } = require('./services/session-service');
const { Runtime } = require('./services/runtime');
const { HlsRegistry } = require('./services/hls-registry');
const { registerMediaProtocol } = require('./media-protocol');
const { MediaServer } = require('./media-server');
const { registerIpc } = require('./ipc');
const {
  getPlatformEnvironment,
  getAppIconPath,
  getTrayIconPath,
  normalizeWindowBounds
} = require('./platform');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'xtmusic',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
      corsEnabled: true
    }
  }
]);

// Desktop playback must continue from tray/media-key commands as well as direct clicks.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.setName('XT Music');
if (process.platform === 'win32') {
  app.setAppUserModelId('com.pkxutao.xtmusic');
}

const instanceData = {
  version: app.getVersion(),
  executablePath: process.execPath
};
const gotLock = app.requestSingleInstanceLock(instanceData);
if (!gotLock) {
  app.quit();
} else {
  start().catch((error) => {
    console.error(error);
    app.exit(1);
  });
}

async function start() {
  const runtime = new Runtime();
  const platformEnvironment = getPlatformEnvironment();
  let accountStore;
  let settingsStore;
  let sessionService;
  let hlsRegistry;
  let mediaServer;
  let diagnostics;
  let isQuitting = false;

  app.on('second-instance', (_event, _argv, _workingDirectory, additionalData) => {
    diagnostics?.log('main', 'app:second-instance', {
      incomingVersion: additionalData?.version,
      sameExecutable: path.resolve(String(additionalData?.executablePath || '')) === path.resolve(process.execPath)
    });
    const incomingVersion = String(additionalData?.version || '');
    const incomingExecutable = String(additionalData?.executablePath || '');
    if (
      incomingVersion &&
      incomingVersion !== app.getVersion() &&
      isTrustedUpgradeExecutable(incomingExecutable)
    ) {
      isQuitting = true;
      diagnostics?.log('main', 'app:upgrade-relaunch', { incomingVersion });
      diagnostics?.flushSync();
      app.relaunch({ execPath: incomingExecutable, args: [] });
      app.exit(0);
      return;
    }

    const win = runtime.mainWindow;
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  await app.whenReady();

  diagnostics = new Diagnostics({ app, clipboard, shell, Notification });
  diagnostics.installProcessHandlers();
  runtime.diagnostics = diagnostics;
  diagnostics.log('main', 'app:ready', {
    executable: path.basename(process.execPath),
    userData: app.getPath('userData'),
    platformEnvironment
  });

  accountStore = new SecureAccountStore(app.getPath('userData'));
  settingsStore = new SettingsStore(app.getPath('userData'));
  hlsRegistry = new HlsRegistry();
  mediaServer = new MediaServer({ runtime, hlsRegistry });
  runtime.mediaServer = mediaServer;
  try {
    await mediaServer.start();
    process.env.XT_MUSIC_MEDIA_BASE_URL = mediaServer.baseUrl;
    diagnostics.log('main', 'media-server:ready', {
      origin: mediaServer.origin,
      hasRandomPathSecret: Boolean(mediaServer.secret)
    });
  } catch (error) {
    diagnostics.log('main', 'media-server:fallback', {
      error: error?.message || String(error)
    }, 'error');
    console.warn(`[MediaServer] loopback proxy unavailable, using protocol fallback: ${error.message}`);
    mediaServer = null;
    runtime.mediaServer = null;
    delete process.env.XT_MUSIC_MEDIA_BASE_URL;
  }
  const transport = diagnostics.instrumentTransport(new HttpTransport());
  sessionService = new SessionService({
    accountStore,
    runtime,
    transport
  });

  registerMediaProtocol({ protocol, runtime, hlsRegistry });
  registerIpc({
    runtime,
    sessionService,
    accountStore,
    settingsStore,
    hlsRegistry,
    mediaServer,
    diagnostics,
    getMainWindow: () => runtime.mainWindow
  });

  runtime.mainWindow = createMainWindow(settingsStore, platformEnvironment);
  diagnostics.attachWindow(runtime.mainWindow);
  runtime.rebuildTrayMenu = () => rebuildTray(runtime, () => {
    isQuitting = true;
    app.quit();
  });
  runtime.tray = createTray(runtime);
  runtime.rebuildTrayMenu();
  diagnostics.startSampling(() => ({
    runtime,
    mediaServer,
    window: runtime.mainWindow
  }));

  const copyShortcutRegistered = globalShortcut.register(
    'CommandOrControl+Shift+L',
    () => void copyDiagnosticLog(runtime)
  );
  const folderShortcutRegistered = globalShortcut.register(
    'CommandOrControl+Shift+O',
    () => void openDiagnosticFolder(runtime)
  );
  diagnostics.log('main', 'diagnostics:shortcuts-registered', {
    copy: copyShortcutRegistered,
    openFolder: folderShortcutRegistered
  });

  runtime.mainWindow.on('close', (event) => {
    if (!isQuitting && runtime.tray && settingsStore.get('closeToTray')) {
      event.preventDefault();
      runtime.mainWindow.hide();
      diagnostics.log('window', 'window:closed-to-tray', {}, 'debug');
    }
  });

  runtime.mainWindow.on('maximize', () => {
    runtime.mainWindow.webContents.send('window:maximized', true);
  });
  runtime.mainWindow.on('unmaximize', () => {
    runtime.mainWindow.webContents.send('window:maximized', false);
  });

  const saveBounds = debounce(() => {
    if (!runtime.mainWindow || runtime.mainWindow.isDestroyed()) return;
    if (runtime.mainWindow.isMaximized() || runtime.mainWindow.isMinimized()) return;
    settingsStore.set('windowBounds', runtime.mainWindow.getBounds());
  }, 500);
  runtime.mainWindow.on('resize', saveBounds);
  runtime.mainWindow.on('move', saveBounds);

  nativeTheme.on('updated', () => {
    if (!runtime.mainWindow?.isDestroyed()) {
      runtime.mainWindow.webContents.send('theme:system', nativeTheme.shouldUseDarkColors);
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
    diagnostics.log('main', 'app:before-quit');
    diagnostics.stopSampling();
    globalShortcut.unregisterAll();
    mediaServer?.close().catch((error) => {
      diagnostics.log('main', 'media-server:close-error', { error: error?.message || String(error) }, 'warning');
    });
    diagnostics.flushSync();
  });

  app.on('activate', () => {
    if (!runtime.mainWindow || runtime.mainWindow.isDestroyed()) {
      runtime.mainWindow = createMainWindow(settingsStore, platformEnvironment);
      diagnostics.attachWindow(runtime.mainWindow);
    } else {
      runtime.mainWindow.show();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

function createMainWindow(settingsStore, platformEnvironment = getPlatformEnvironment()) {
  const stored = settingsStore.get('windowBounds');
  const validated = validateBounds(stored, platformEnvironment);
  const bounds = normalizeWindowBounds(validated || stored, platformEnvironment);
  const windowOptions = {
    ...bounds,
    title: `XT Music ${app.getVersion()} Diagnostic`,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    frame: platformEnvironment.nativeFrame,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d12',
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false,
      webSecurity: true
    }
  };

  if (process.platform === 'win32') {
    windowOptions.thickFrame = true;
    windowOptions.backgroundMaterial = 'mica';
  }

  const win = new BrowserWindow(windowOptions);
  win.setMenu(null);
  Menu.setApplicationMenu(null);

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
  win.webContents.on('context-menu', (event) => {
    event.preventDefault();
  });

  win.loadFile(path.join(__dirname, '../../dist/renderer/index.html'));
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });
  return win;
}

function createTray(runtime) {
  try {
    let image = nativeImage.createFromPath(getTrayIconPath());
    if (image.isEmpty()) return null;
    const size = process.platform === 'linux' ? 22 : 20;
    image = image.resize({ width: size, height: size });
    const tray = new Tray(image);
    tray.setToolTip(`XT Music ${app.getVersion()} Diagnostic`);

    const toggleWindow = () => {
      const win = runtime.mainWindow;
      if (!win) return;
      if (win.isVisible()) win.hide();
      else {
        win.show();
        win.focus();
      }
    };

    if (process.platform === 'linux') tray.on('click', toggleWindow);
    else tray.on('double-click', toggleWindow);
    return tray;
  } catch (error) {
    runtime.diagnostics?.log('main', 'tray:unavailable', { error: error?.message || String(error) }, 'warning');
    console.warn(`[Tray] unavailable: ${error.message}`);
    return null;
  }
}

function rebuildTray(runtime, quit) {
  if (!runtime.tray) return;
  const player = runtime.playerState || {};
  const send = (command) => {
    if (!runtime.mainWindow || runtime.mainWindow.isDestroyed()) return;
    runtime.mainWindow.webContents.send('player:command', command);
  };

  const menu = Menu.buildFromTemplate([
    {
      label: runtime.mainWindow?.isVisible() ? '隐藏 XT Music' : '打开 XT Music',
      click: () => {
        const win = runtime.mainWindow;
        if (!win) return;
        if (win.isVisible()) win.hide();
        else {
          win.show();
          win.focus();
        }
      }
    },
    { type: 'separator' },
    {
      label: player.playing ? '暂停' : '播放',
      enabled: Boolean(player.title),
      click: () => send('toggle')
    },
    {
      label: '上一首',
      enabled: Boolean(player.canPrevious),
      click: () => send('previous')
    },
    {
      label: '下一首',
      enabled: Boolean(player.canNext),
      click: () => send('next')
    },
    { type: 'separator' },
    {
      label: '复制诊断日志  Ctrl+Shift+L',
      click: () => void copyDiagnosticLog(runtime)
    },
    {
      label: '打开诊断日志目录  Ctrl+Shift+O',
      click: () => void openDiagnosticFolder(runtime)
    },
    {
      label: '记录即时诊断快照',
      click: () => void runtime.diagnostics?.snapshot({
        runtime,
        mediaServer: runtime.mediaServer,
        window: runtime.mainWindow,
        reason: 'tray-snapshot'
      })
    },
    { type: 'separator' },
    { label: '退出', click: quit }
  ]);
  runtime.tray.setContextMenu(menu);
  runtime.tray.setToolTip(
    player.title
      ? `${player.playing ? '正在播放' : '已暂停'}：${player.title}${player.artist ? ` · ${player.artist}` : ''}`
      : `XT Music ${app.getVersion()} Diagnostic`
  );
}

async function copyDiagnosticLog(runtime) {
  try {
    await runtime.diagnostics?.snapshot({
      runtime,
      mediaServer: runtime.mediaServer,
      window: runtime.mainWindow,
      reason: 'copy-request'
    });
    const result = await runtime.diagnostics?.copyToClipboard();
    if (result && runtime.tray && process.platform === 'win32') {
      try {
        runtime.tray.displayBalloon({
          title: 'XT Music 诊断日志',
          content: '日志已复制到剪贴板，可直接粘贴给我。',
          noSound: true
        });
      } catch {
        // Notification fallback is handled by Diagnostics.
      }
    }
  } catch (error) {
    runtime.diagnostics?.log('main', 'diagnostics:copy-failed', {
      error: error?.message || String(error)
    }, 'error');
  }
}

async function openDiagnosticFolder(runtime) {
  try {
    await runtime.diagnostics?.openFolder();
  } catch (error) {
    runtime.diagnostics?.log('main', 'diagnostics:open-folder-failed', {
      error: error?.message || String(error)
    }, 'error');
  }
}

function isTrustedUpgradeExecutable(candidate) {
  if (!candidate) return false;
  const resolved = path.resolve(candidate);
  if (resolved === path.resolve(process.execPath)) return true;
  if (process.platform === 'linux') {
    return resolved === '/opt/XT Music/xtmusic';
  }
  return false;
}

function validateBounds(bounds, platformEnvironment = getPlatformEnvironment()) {
  if (!bounds || typeof bounds !== 'object') return null;
  if (platformEnvironment.isWayland) {
    return {
      width: bounds.width,
      height: bounds.height
    };
  }

  const displays = screen.getAllDisplays();
  const visible = displays.some((display) => {
    const area = display.workArea;
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    );
  });
  return visible ? bounds : null;
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
