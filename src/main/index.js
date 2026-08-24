'use strict';

const path = require('node:path');
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  nativeTheme,
  protocol,
  screen
} = require('electron');
const { HttpTransport } = require('./protocol/http-transport');
const { SecureAccountStore } = require('./storage/secure-store');
const { SettingsStore } = require('./storage/settings-store');
const { SessionService } = require('./services/session-service');
const { Runtime } = require('./services/runtime');
const { HlsRegistry } = require('./services/hls-registry');
const { registerMediaProtocol } = require('./media-protocol');
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
  start();
}

async function start() {
  const runtime = new Runtime();
  const platformEnvironment = getPlatformEnvironment();
  let accountStore;
  let settingsStore;
  let sessionService;
  let hlsRegistry;
  let isQuitting = false;

  app.on('second-instance', (_event, _argv, _workingDirectory, additionalData) => {
    const incomingVersion = String(additionalData?.version || '');
    const incomingExecutable = String(additionalData?.executablePath || '');
    if (
      incomingVersion &&
      incomingVersion !== app.getVersion() &&
      isTrustedUpgradeExecutable(incomingExecutable)
    ) {
      // The package was upgraded while an older tray process was still alive.
      // Restart through the newly installed executable instead of focusing the
      // stale process. The DEB pre-install hook handles upgrades from versions
      // that predate this handshake.
      isQuitting = true;
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

  accountStore = new SecureAccountStore(app.getPath('userData'));
  settingsStore = new SettingsStore(app.getPath('userData'));
  hlsRegistry = new HlsRegistry();
  const transport = new HttpTransport();
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
    getMainWindow: () => runtime.mainWindow
  });

  runtime.mainWindow = createMainWindow(settingsStore, platformEnvironment);
  runtime.rebuildTrayMenu = () => rebuildTray(runtime, () => {
    isQuitting = true;
    app.quit();
  });
  runtime.tray = createTray(runtime);
  runtime.rebuildTrayMenu();

  runtime.mainWindow.on('close', (event) => {
    if (!isQuitting && runtime.tray && settingsStore.get('closeToTray')) {
      event.preventDefault();
      runtime.mainWindow.hide();
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
  });

  app.on('activate', () => {
    if (!runtime.mainWindow || runtime.mainWindow.isDestroyed()) {
      runtime.mainWindow = createMainWindow(settingsStore, platformEnvironment);
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
    title: `XT Music ${app.getVersion()}`,
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
    tray.setToolTip(`XT Music ${app.getVersion()}`);

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
    { label: '退出', click: quit }
  ]);
  runtime.tray.setContextMenu(menu);
  runtime.tray.setToolTip(
    player.title
      ? `${player.playing ? '正在播放' : '已暂停'}：${player.title}${player.artist ? ` · ${player.artist}` : ''}`
      : `XT Music ${app.getVersion()}`
  );
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
