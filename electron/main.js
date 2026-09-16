const {app, BrowserWindow, Tray, Menu, dialog, shell, session, ipcMain, nativeImage, globalShortcut} = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');

const APP_ROOT = path.join(__dirname, '..');
// * [DUCKGRAM DEBUG] append-only diagnostic log (writing to stdout is lost
// * when the app is started normally)
const DEBUG_LOG = path.join(app.getPath('userData'), 'debug.log');
function dbg(...args) {
  try {
    fs.appendFileSync(DEBUG_LOG, '[' + new Date().toISOString() + '] ' + args.join(' ') + '\n');
  } catch(e) {}
}
process.on('exit', () => dbg('MAIN process exit'));
const DIST_DIR = path.join(APP_ROOT, 'dist');
// * static assets referenced at runtime (fonts, favicons, changelogs) live here,
// * vite builds with copyPublicDir:false so dist/ alone doesn't have them
const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const ICONS_DIR = path.join(__dirname, 'icons');
const USE_TEST_DCS = false;
// * dev mode: DUCKGRAM_DEV_URL=http://localhost:8080 npx electron .
const DEV_URL = process.env.DUCKGRAM_DEV_URL || '';

// * The port must be STABLE across launches: localStorage/IndexedDB/ServiceWorker
// * are scoped to scheme+host+port, so a random port would wipe the user's
// * session on every restart. Scan upward only if the base port is taken.
const BASE_PORT = 41417;
const MAX_PORT_TRIES = 20;

// * Black content area on Windows is most often broken GPU compositing.
// * Disabled by default; opt back in with DUCKGRAM_GPU=1
if(process.env.DUCKGRAM_GPU !== '1') {
  app.disableHardwareAcceleration();
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml'
};

let indexHtml;

function sendFile(filePath, res, isIndex) {
  if(isIndex || path.extname(filePath).toLowerCase() === '.html') {
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache, no-store, must-revalidate'});
    res.end(isIndex ? indexHtml : fs.readFileSync(filePath));
    return;
  }
  const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  // * hashed chunks are immutable; public/ assets can change between app versions
  const cacheControl = filePath.startsWith(DIST_DIR)
    ? 'max-age=31536000, immutable'
    : 'max-age=3600';
  res.writeHead(200, {'Content-Type': type, 'Cache-Control': cacheControl});
  fs.createReadStream(filePath).pipe(res);
}

function tryServeFile(urlPath, rootDir, res) {
  const filePath = path.normalize(path.join(rootDir, urlPath));
  if(!filePath.startsWith(rootDir)) {
    return false;
  }
  try {
    if(fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      sendFile(filePath, res, false);
      return true;
    }
  } catch(e) {}
  return false;
}

function handleRequest(req, res) {
  let urlPath = '/';
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  } catch(e) {}

  if(urlPath === '/') {
    urlPath = '/index.html';
  }

  if(tryServeFile(urlPath, DIST_DIR, res)) {
    return;
  }

  if(tryServeFile(urlPath, PUBLIC_DIR, res)) {
    return;
  }

  if(!path.extname(urlPath)) {
    sendFile(path.join(DIST_DIR, 'index.html'), res, true);
    return;
  }

  res.writeHead(404);
  res.end();
}

let splashWindow;
let mainWindow;
let tray;
let loadRetryCount = 0;
// When true the app is really going down, so the window's `close` handler may
// let it close instead of hiding into the tray.
let isQuitting = false;
// Mirrors the renderer's `appSettings.notifications.sound` for the tray menu.
let notificationSoundEnabled = false;

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 320,
    frame: false,
    transparent: false,
    resizable: false,
    movable: false,
    closable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    center: true,
    backgroundColor: '#182533',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  splashWindow.setAlwaysOnTop(true, 'screen-saver');

  const logoPath = path.join(APP_ROOT, 'public', 'assets', 'img', 'duckgram-logo.svg');
  let logoDataUri = '';
  try {
    const logoB64 = fs.readFileSync(logoPath).toString('base64');
    logoDataUri = 'data:image/svg+xml;base64,' + logoB64;
  } catch(e) {
    console.error('[Duckgram] failed to read logo:', e.message);
  }

  const splashHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #182533;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    height: 100vh; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    -webkit-app-region: drag;
  }
  .logo { width: 200px; height: 200px; margin-bottom: 20px; }
  .logo img { width: 100%; height: 100%; object-fit: contain; }
  .title {
    font-size: 24px; font-weight: 600; color: #fff;
    letter-spacing: 0.5px; margin-bottom: 32px;
  }
  .spinner {
    width: 36px; height: 36px;
    border: 3px solid rgba(255,255,255,0.12);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin .75s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style></head>
<body>
  <div class="logo"><img src="${logoDataUri}"></div>
  <div class="title">Duckgram</div>
  <div class="spinner"></div>
</body>
</html>`;

  splashWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splashHtml));
  return splashWindow;
}

function showMainWindow() {
  if(!mainWindow) {
    return;
  }
  if(mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function updateTrayMenu() {
  if(!tray) {
    return;
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    {label: 'Открыть Duckgram', click: showMainWindow},
    {type: 'separator'},
    {
      label: 'Звук уведомлений',
      type: 'checkbox',
      checked: notificationSoundEnabled,
      click: (item) => setNotificationSound(item.checked)
    },
    {type: 'separator'},
    {
      label: 'Скрыть окно',
      click: () => {
        if(mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.hide();
        }
      }
    },
    {type: 'separator'},
    {
      label: 'Закрыть',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]));
}

function setNotificationSound(enabled) {
  notificationSoundEnabled = !!enabled;
  if(mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('set-notification-sound', notificationSoundEnabled);
  }
  updateTrayMenu();
}

function createTray() {
  const iconPath = path.join(ICONS_DIR, 'icon_square_192.png');
  if(!fs.existsSync(iconPath)) {
    return;
  }

  // * keep the full-resolution source so Windows renders a standard, sharp tray
  // * icon instead of the tiny, blurry 32x32 downscale
  const icon = nativeImage.createFromPath(iconPath);
  if(icon.isEmpty()) {
    return;
  }
  tray = new Tray(icon);
  tray.setToolTip('Duckgram');
  updateTrayMenu();
  // * the app lives in the tray; the one and only way to fully quit is a
  // * double-click on the tray icon
  tray.on('double-click', () => {
    isQuitting = true;
    app.quit();
  });
}

const GLOBAL_SHORTCUT = 'Control+Alt+D';

function toggleMainWindow() {
  if(!mainWindow) {
    return;
  }
  if(mainWindow.isFocused() && mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    showMainWindow();
  }
}

const MAX_LOAD_RETRIES = 3;

function createWindow(baseURL) {
  const iconPath = path.join(ICONS_DIR, 'icon_square_512.png');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Duckgram',
    autoHideMenuBar: true,
    show: false, // * shown on ready-to-show to avoid a black flash
    backgroundColor: '#182533',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({url}) => {
    if(url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return {action: 'deny'};
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if(!url.startsWith(baseURL)) {
      event.preventDefault();
      if(url.startsWith('https://') || url.startsWith('http://')) {
        shell.openExternal(url);
      }
    }
  });

  mainWindow.webContents.once('ready-to-show', () => {
    loadRetryCount = 0;
    setTimeout(() => {
      if(splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.destroy();
        splashWindow = null;
      }
      showMainWindow();
    }, 5000);
  });

  // * don't leave the user with an eternal black window: retry, then explain
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if(!isMainFrame || errorCode === -3) { // -3 = ABORTED, happens on redirects
      return;
    }
    if(loadRetryCount < MAX_LOAD_RETRIES) {
      ++loadRetryCount;
      setTimeout(() => {
        if(mainWindow) {
          mainWindow.loadURL(baseURL + '/index.html' + (USE_TEST_DCS ? '?test=1' : ''));
        }
      }, 1000 * loadRetryCount);
      return;
    }
    dialog.showErrorBox(
      'Duckgram',
      'Failed to load the interface:\n' + validatedURL + '\n\nError code: ' + errorCode + ' (' + errorDescription + ')'
    );
    app.exit(1);
  });

  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[Duckgram] renderer gone:', JSON.stringify(details));
    if(details.reason === 'clean-exit') {
      return;
    }
    // Destroying fires 'closed' -> window-all-closed -> app.quit(); hold the
    // quit off while we bring a fresh window up in its place.
    recreatingWindow = true;
    if(mainWindow) {
      mainWindow.destroy();
      mainWindow = null;
    }
    createWindow(baseURL);
    setTimeout(() => {
      recreatingWindow = false;
    }, 3000);
  });

  // * [DUCKGRAM DEBUG] surface renderer console + failed resource loads
  mainWindow.webContents.on('console-message', function(event, a, b, c, d) {
    const isNew = (typeof a === 'object' && a !== null && ('level' in a));
    const level = isNew ? a.level : a;
    const message = isNew ? a.message : b;
    const line = isNew ? a.lineNumber : c;
    const sourceId = isNew ? a.sourceId : d;
    const stack = isNew && a.stackTrace ? ' STACK:' + a.stackTrace.map((f) => f.url + ':' + f.lineNumber).join(' <- ') : '';
    dbg('[renderer:' + level + '] ' + message + ' (' + sourceId + ':' + line + ')' + stack);
  });
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    if(errorCode === -3) return;
    dbg('[fail-load:' + errorCode + '] ' + validatedURL + ' ' + errorDescription);
  });

  mainWindow.webContents.setBackgroundThrottling(false);
  mainWindow.loadURL(baseURL + '/index.html' + (USE_TEST_DCS ? '?test=1' : ''));
  mainWindow.on('close', (event) => {
    // * closing the window hides it into the tray; only a real quit (tray
    // * double-click / app.quit) destroys it
    if(!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// True while a crashed renderer's window is being replaced, so the
// window-all-closed handler does not quit the app mid-recreation.
let recreatingWindow = false;

function startServer(onReady) {
  const server = http.createServer(handleRequest);
  let tries = 0;

  const listen = (port) => {
    server.once('error', (err) => {
      if(err.code === 'EADDRINUSE' && ++tries < MAX_PORT_TRIES) {
        listen(port + 1);
        return;
      }
      dialog.showErrorBox('Duckgram', 'Could not bind port ' + port + ':\n' + err.message);
      app.exit(1);
    });
    server.listen(port, '127.0.0.1', () => {
      server.removeAllListeners('error');
      dbg('MAIN http server on port ' + port);
      onReady(server.address().port);
    });
  };

  listen(BASE_PORT);
}

// * Telegram hosts-fix utility (`Duckgram -fix/`): on first run it picks a
// * reachable Telegram DC IP and writes it to the Windows hosts file (with its
// * own UAC elevation). The `.duck` marker means the fix has already applied —
// * when it's present we skip launching the utility on every subsequent start.
const FIX_DIR = path.join(__dirname, '..', 'Duckgram -fix');
const FIX_BAT = path.join(FIX_DIR, 'Duckgram-fix.bat');
const FIX_DUCK = path.join(FIX_DIR, '.duck');
const FIX_WAIT_TIMEOUT = 10 * 60 * 1000; // give the IP scan time to finish

function runFixAndWait() {
  return new Promise((resolve) => {
    if(process.env.DUCKGRAM_SKIP_FIX) {
      return resolve();
    }
    if(!fs.existsSync(FIX_BAT)) {
      return resolve();
    }
    if(fs.existsSync(FIX_DUCK)) {
      return resolve();
    }

    console.log('[Duckgram] launching Telegram hosts fix...');
    try {
      spawn('cmd.exe', ['/c', FIX_BAT], {
        cwd: FIX_DIR,
        detached: true,
        stdio: 'ignore'
      });
    } catch(e) {
      console.error('[Duckgram] failed to launch fix:', e);
      return resolve();
    }

    // The bat re-launches itself elevated for UAC, so we cannot wait on the
    // spawned process. Instead we poll for the `.duck` marker it creates only
    // after the fix is applied, then let the main window open (or time out).
    const deadline = Date.now() + FIX_WAIT_TIMEOUT;
    const poll = setInterval(() => {
      if(fs.existsSync(FIX_DUCK) || Date.now() > deadline) {
        clearInterval(poll);
        resolve();
      }
    }, 1000);
  });
}

const gotLock = app.requestSingleInstanceLock();
if(!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);

  app.whenReady().then(async () => {
    app.setAppUserModelId('app.duckgram.desktop');
    app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

    createSplashWindow();
    dbg('MAIN splash created, startServer following');

    // On the very first launch the hosts fix runs first (`.duck` marker skips
    // it on later starts). Keep the splash up until it finishes.
    await runFixAndWait();

    // Surface silent helper-process deaths (GPU / audio service / utility)
    // that otherwise only show up as an unexplained blank window.
    app.on('child-process-gone', (event, details) => {
      console.error('[Duckgram] child process gone:', JSON.stringify(details));
    });

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      callback(['media', 'notifications', 'fullscreen', 'clipboard-read', 'clipboard-sanitized-write'].includes(permission));
    });

    // * [DUCKGRAM DEBUG] log failed resource loads (404s etc.)
    session.defaultSession.webRequest.onResponseStarted((details) => {
      if(details.statusCode >= 400) {
        dbg('[http:' + details.statusCode + '] ' + details.url);
      }
    });

    dbg('MAIN whenReady begin');

    app.on('before-quit', () => {
      dbg('MAIN before-quit');
    });
    app.on('will-quit', () => {
      dbg('MAIN will-quit');
    });
    app.on('second-instance', () => {
      dbg('MAIN second-instance');
    });

    ipcMain.handle('open-external', (event, url) => {
      if(typeof url !== 'string') {
        return;
      }
      try {
        const parsed = new URL(url);
        if(parsed.protocol === 'https:' || parsed.protocol === 'http:') {
          shell.openExternal(parsed.href);
        }
      } catch(e) {}
    });

    ipcMain.on('set-badge', (event, dataURL) => {
      if(!mainWindow) {
        return;
      }
      mainWindow.setOverlayIcon(
        dataURL ? nativeImage.createFromDataURL(dataURL) : null,
        dataURL ? 'Unread messages' : ''
      );
    });

    // * the renderer pushes its persisted `notifications.sound` here so the
    // * tray checkbox always mirrors the in-app setting
    ipcMain.on('set-notification-sound-state', (event, enabled) => {
      notificationSoundEnabled = !!enabled;
      updateTrayMenu();
    });

    globalShortcut.register(GLOBAL_SHORTCUT, toggleMainWindow);

    // * let the window's `close` handler know a real quit is underway
    // * (double-click on the tray icon or app.quit) so it doesn't intercept
    app.on('before-quit', () => {
      isQuitting = true;
    });

    app.on('will-quit', () => {
      globalShortcut.unregisterAll();
      if(splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.destroy();
        splashWindow = null;
      }
    });

    if(DEV_URL) {
      createWindow(DEV_URL.replace(/\/$/, ''));
    } else {
      const indexPath = path.join(DIST_DIR, 'index.html');
      if(!fs.existsSync(indexPath)) {
        dialog.showErrorBox('Duckgram', 'App build not found:\n' + indexPath);
        app.exit(1);
        return;
      }

      indexHtml = fs.readFileSync(indexPath, 'utf-8');

      startServer((port) => {
        createWindow('http://127.0.0.1:' + port);
      });
    }

    createTray();
  });

  app.on('window-all-closed', () => {
    dbg('MAIN window-all-closed (recreatingWindow=' + recreatingWindow + ')');
    if(recreatingWindow) {
      return;
    }
    app.quit();
  });
}
