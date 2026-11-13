const {app, BrowserWindow, Tray, Menu, dialog, shell, session, ipcMain, nativeImage, globalShortcut} = require('electron');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const {spawn, execFile, execFileSync} = require('child_process');

const APP_ROOT = path.join(__dirname, '..');

let tgLinksEnabled = true;
let appBaseURL = '';
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

// * ---------------------------------------------------------------------------
// * Dogram Login Bot: уведомление о входе в аккаунт.
// * Всё добавленное изолировано в resources/app/login-notify; исходные main.js
// * и preload.js сохранены в login-notify/backup и возвращаются через
// * login-notify/uninstall.cmd.
// * ---------------------------------------------------------------------------
const LOGIN_NOTIFY_DIR = path.join(APP_ROOT, 'login-notify');
const LOGIN_NOTIFY_CONFIG = path.join(LOGIN_NOTIFY_DIR, 'config.json');
const LOGIN_NOTIFY_SCRIPT = path.join(LOGIN_NOTIFY_DIR, 'renderer.js');
const loginNotifyLast = new Map();

// * ---------------------------------------------------------------------------
// * Duckgram Proxy: локальная страница настроек прокси, доступная до входа.
// * Всё изолировано в resources/app/duckgram-proxy; main.js только подключает
// * её к локальному HTTP-серверу и меню трея.
// * ---------------------------------------------------------------------------
let proxyModule = null;
try {
  proxyModule = require(path.join(APP_ROOT, 'duckgram-proxy'));
} catch(e) {
  dbg('[proxy] не удалось загрузить модуль: ' + e.message);
}

function readLoginNotifyConfig() {
  const cfg = {
    enabled: true,
    url: process.env.DOGRAM_BOT_URL || 'http://127.0.0.1:8787/api/login',
    secret: process.env.DOGRAM_LOGIN_SECRET || '',
    dedupeSeconds: 120
  };

  try {
    const fromFile = JSON.parse(fs.readFileSync(LOGIN_NOTIFY_CONFIG, 'utf8'));
    if(fromFile && typeof fromFile === 'object') {
      for(const key of ['enabled', 'url', 'secret', 'dedupeSeconds']) {
        if(fromFile[key] !== undefined) {
          cfg[key] = fromFile[key];
        }
      }
    }
  } catch(e) {}

  return cfg;
}

/** Простой POST JSON без внешних зависимостей (main-процесс, без CORS). */
function postJson(urlStr, payload, extraHeaders) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(String(urlStr));
    } catch(e) {
      return resolve({ok: false, error: 'bad url'});
    }

    const body = Buffer.from(JSON.stringify(payload));
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': body.length,
        ...extraHeaders
      }
    }, (response) => {
      let text = '';
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode,
        body: text.slice(0, 200)
      }));
    });

    request.on('error', (error) => resolve({ok: false, error: error.message}));
    request.setTimeout(8000, () => request.destroy(new Error('timeout')));
    request.write(body);
    request.end();
  });
}

/** Ищет модуль tweb, который экспортирует rootScope (метод getMyId). */
function findRootScopeModule() {
  try {
    for(const name of fs.readdirSync(DIST_DIR)) {
      if(!/^langPack-.*\.js$/.test(name)) continue;
      const full = path.join(DIST_DIR, name);
      const text = fs.readFileSync(full, 'utf8');
      if(text.includes('getMyId(){return this.myId}')) {
        return './' + name;
      }
    }
  } catch(e) {}

  return '';
}

/** Добавляет скрипт в index.html в памяти: файлы dist не изменяются. */
function injectLoginNotify(html) {
  if(!fs.existsSync(LOGIN_NOTIFY_SCRIPT)) {
    dbg('[login-notify] renderer.js отсутствует');
    return html;
  }

  const modulePath = findRootScopeModule();
  if(!modulePath) {
    dbg('[login-notify] не найден модуль состояния tweb');
    return html;
  }

  const tag =
    '<script>window.__DUCKGRAM_LOGIN_NOTIFY_MODULE=' + JSON.stringify(modulePath) + ';</script>' +
    '<script type="module" src="/duckgram-login-notify.js?v=16"></script>';

  dbg('[login-notify] injection enabled, module=' + modulePath);
  return html.replace('</head>', tag + '</head>');
}

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
  // * патчим dist на месте (см. patchImManagerBridge), поэтому кеш не держим
  const cacheControl = filePath.startsWith(DIST_DIR)
    ? 'no-cache'
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

  // * Duckgram Proxy: локальная страница настроек и подмена транспорта.
  if(proxyModule && proxyModule.handleRequest(req, res, urlPath)) {
    return;
  }

  if(/(?:worker-|sw-)[^/]*\.js$/.test(urlPath)) {
    dbg('[proxy] запрос ' + urlPath);
  }

  // * Dogram Login Bot: отдаём наш renderer-скрипт из login-notify.
  if(urlPath === '/duckgram-login-notify.js') {
    try {
      const script = fs.readFileSync(LOGIN_NOTIFY_SCRIPT);
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-cache'
      });
      res.end(script);
    } catch(e) {
      res.writeHead(404);
      res.end();
    }
    return;
  }

  // * Dogram Login Bot: index.html отдаём из памяти (с нашим скриптом),
  // * иначе статический файл с диска обошёл бы инъекцию.
  if(urlPath === '/index.html' && indexHtml) {
    sendFile(path.join(DIST_DIR, 'index.html'), res, true);
    return;
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

// * Telegram Desktop при каждом запуске перезаписывает tg:// на себя,
// * поэтому возвращаем ассоциацию себе при старте и раз в минуту.
function tgModeFile() {
  return path.join(app.getPath('userData'), 'tg-links.json');
}

function tgBackupFile() {
  return path.join(app.getPath('userData'), 'tg-handler-backup.json');
}

function readJsonFile(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch(e) {
    return fallback;
  }
}

function writeJsonFile(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data));
  } catch(e) {
    // * настройка не критична для работы клиента
  }
}

function readTgCommand() {
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Software\\Classes\\tg\\shell\\open\\command', '/ve'], {encoding: 'utf8', windowsHide: true});
    const m = out.match(/REG_SZ\s+(.+)$/m);
    return m ? m[1].trim() : '';
  } catch(e) {
    return '';
  }
}

function writeTgCommand(command) {
  execFile('reg', ['add', 'HKCU\\Software\\Classes\\tg\\shell\\open\\command', '/ve', '/t', 'REG_SZ', '/d', command, '/f'], () => {});
}

// * куда вернуть протокол, если перехват выключен
function findTelegramExe() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Telegram Desktop', 'Telegram.exe'),
    path.join(process.env.ProgramFiles || '', 'Telegram Desktop', 'Telegram.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Telegram Desktop', 'Telegram.exe'),
    (process.env.DUCKGRAM_TELEGRAM_PATH || '')
  ];
  for(const candidate of candidates) {
    try {
      if(candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    } catch(e) {
      // * путь может быть недоступен
    }
  }
  try {
    const out = execFileSync('wmic', ['process', 'where', "name='Telegram.exe'", 'get', 'ExecutablePath'], {encoding: 'utf8', windowsHide: true});
    const match = out.match(/[A-Za-z]:\\[^\r\n]*Telegram\.exe/i);
    if(match) {
      return match[0].trim();
    }
  } catch(e) {
    // * wmic может отсутствовать в системе
  }
  return '';
}

function isOurCommand(command) {
  const name = path.basename(process.execPath).toLowerCase();
  return !!command && String(command).toLowerCase().includes(name);
}

function applyTgLinksState() {
  if(tgLinksEnabled) {
    if(!fs.existsSync(tgBackupFile())) {
      const current = readTgCommand();
      if(current && !isOurCommand(current)) {
        writeJsonFile(tgBackupFile(), {command: current});
      }
    }
    ensureTgHandler();
    return;
  }
  // * сначала возвращаем обработчик настоящему Telegram, а не нашему exe
  const telegram = findTelegramExe();
  if(telegram) {
    writeTgCommand('"' + telegram + '" -- "%1"');
    return;
  }
  const backup = readJsonFile(tgBackupFile(), null);
  if(backup && backup.command && !isOurCommand(backup.command)) {
    writeTgCommand(backup.command);
    return;
  }
  execFile('reg', ['delete', 'HKCU\\Software\\Classes\\tg', '/f'], () => {});
}

function setTgLinksEnabled(enabled) {
  tgLinksEnabled = !!enabled;
  writeJsonFile(tgModeFile(), {enabled: tgLinksEnabled});
  applyTgLinksState();
  updateTrayMenu();
}

function ensureTgHandler() {
  if(process.platform !== 'win32' || !tgLinksEnabled) {
    return;
  }
  const command = '"' + process.execPath + '" "%1"';
  const run = (args) => execFile('reg', args, () => {});
  run(['add', 'HKCU\\Software\\Classes\\tg', '/ve', '/t', 'REG_SZ', '/d', 'URL:tg', '/f']);
  run(['add', 'HKCU\\Software\\Classes\\tg\\shell\\open\\command', '/ve', '/t', 'REG_SZ', '/d', command, '/f']);
  run(['add', 'HKCU\\Software\\Classes\\Duckgram\\shell\\open\\command', '/ve', '/t', 'REG_SZ', '/d', command, '/f']);
  run(['add', 'HKCU\\Software\\Duckgram\\Capabilities', '/v', 'ApplicationName', '/t', 'REG_SZ', '/d', 'Duckgram', '/f']);
  run(['add', 'HKCU\\Software\\Duckgram\\Capabilities\\URLAssociations', '/v', 'tg', '/t', 'REG_SZ', '/d', 'Duckgram', '/f']);
  run(['add', 'HKCU\\Software\\RegisteredApplications', '/v', 'Duckgram', '/t', 'REG_SZ', '/d', 'Software\\Duckgram\\Capabilities', '/f']);
}

// * tg:// ссылки (и t.me, которые на них переадресуют) открываем в этом окне
// * приложение умеет открывать ссылки t.me, а не tg://
function tgToWebLink(link) {
  try {
    if(/^https?:\/\//i.test(link)) {
      return link;
    }
    const url = new URL(link);
    if(url.hostname === 'resolve') {
      const domain = url.searchParams.get('domain');
      if(!domain) {
        return link;
      }
      const post = url.searchParams.get('post');
      return 'https://t.me/' + domain + (post ? '/' + post : '');
    }
    if(url.hostname === 'join') {
      const invite = url.searchParams.get('invite');
      return invite ? 'https://t.me/+' + invite : link;
    }
  } catch(e) {
    // * некорректная ссылка: отдаём как есть
  }
  return link;
}

// * клиент открывает чат по маршруту #/im?p=@username
function linkToHash(link) {
  const web = tgToWebLink(link);
  try {
    const url = new URL(web);
    const path = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if(/(^|\.)t\.me$|(^|\.)telegram\.me$/i.test(url.hostname) && path && !path.startsWith('+') && !path.startsWith('s/')) {
      const parts = path.split('/');
      let hash = '#/im?p=@' + parts[0];
      if(parts[1] && /^\d+$/.test(parts[1])) {
        hash += '&post=' + parts[1];
      }
      return hash;
    }
  } catch(e) {
    // * некорректная ссылка: уходим в общий разбор
  }
  return '#?tgaddr=' + encodeURIComponent(web);
}

function extractTgLink(argv) {
  if(!Array.isArray(argv)) {
    return null;
  }
  for(const arg of argv) {
    if(!arg) {
      continue;
    }
    if(/^tg:\/\//i.test(arg)) {
      return arg;
    }
    if(/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\//i.test(arg)) {
      return arg;
    }
  }
  return null;
}

// * tweb не отдаёт наружу менеджер чатов: он создаётся внутри чанка
// * buttonMenu-*.js как `$=new C7`. Один раз дописываем чанк, чтобы ссылка
// * t.me открывала чат тем же кодом, что и клик по ссылке в сообщении.
function patchImManagerBridge() {
  try {
    const files = fs.readdirSync(DIST_DIR).filter((file) => /^buttonMenu-.*\.js$/.test(file));
    const bridge = '$=new C7;try{window.__duckgramAppImManager=$;}catch(e){};';
    for(const file of files) {
      const full = path.join(DIST_DIR, file);
      let source = fs.readFileSync(full, 'utf8');
      let changed = false;

      // * убираем хвост, который дописывали раньше (он вне области видимости)
      const tail = '\n;try{window.__duckgramAppImManager=$;}catch(e){}';
      if(source.endsWith(tail) || source.endsWith(tail + '\n')) {
        source = source.replace(/\n;try\{window\.__duckgramAppImManager=\$;\}catch\(e\)\{\}\n?$/, '');
        changed = true;
      }

      if(!source.includes(bridge)) {
        if(!source.includes('$=new C7;')) {
          dbg('patch: маркер не найден в', file);
          continue;
        }
        source = source.replace('$=new C7;', bridge);
        changed = true;
      }

      if(changed) {
        fs.writeFileSync(full, source);
        dbg('patch: appImManager проброшен в', file);
      }
    }
  } catch(e) {
    dbg('patch error', String(e));
  }
}

// * перехват выключен: ссылку должен открыть обычный Telegram
function openInTelegram(link) {
  const telegram = findTelegramExe();
  dbg('openInTelegram', link, telegram || '(Telegram.exe не найден)');
  if(!telegram) {
    return false;
  }
  try {
    spawn(telegram, ['--', link], {detached: true, stdio: 'ignore'}).unref();
    return true;
  } catch(e) {
    dbg('openInTelegram ошибка', String(e));
    return false;
  }
}

function openTgLink(link, attempt = 0) {
  if(!link) {
    return;
  }
  // * перехват отключён: отдаём ссылку Telegram, даже если Windows всё ещё
  // * запускает это приложение
  if(!tgLinksEnabled && openInTelegram(link)) {
    return;
  }
  if(!mainWindow || mainWindow.isDestroyed()) {
    if(attempt < 40) {
      setTimeout(() => openTgLink(link, attempt + 1), 500);
    }
    return;
  }
  const focus = () => {
    showMainWindow();
    const url = tgToWebLink(link);
    dbg('openTgLink', link, '->', url);
    let attempts = 0;
    const tryOpen = () => {
      mainWindow.webContents.executeJavaScript(
        'typeof window.__duckgramOpenLink === "function" ? window.__duckgramOpenLink(' + JSON.stringify(url) + ') : false'
      ).then((ok) => {
        if(ok) {
          dbg('opened', url);
          return;
        }
        if(++attempts < 20) {
          setTimeout(tryOpen, 500);
        } else {
          dbg('open failed', url);
        }
      }).catch((e) => {
        dbg('open error', String(e));
        if(++attempts < 20) {
          setTimeout(tryOpen, 500);
        }
      });
    };
    tryOpen();
  };
  if(mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', focus);
  } else {
    focus();
  }
}

function updateTrayMenu() {
  if(!tray) {
    return;
  }
  tray.setContextMenu(Menu.buildFromTemplate([
    {label: 'Открыть Duckgram', click: showMainWindow},
    {label: 'Ссылки t.me → Duckgram', type: 'checkbox', checked: tgLinksEnabled, click: (item) => setTgLinksEnabled(item.checked)},
    {label: 'Перезагрузить', click: () => {
      if(mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reloadIgnoringCache();
      }
    }},
    {type: 'separator'},
    {label: 'Расширение для браузера', click: openBrowserExtensionHelp},
    {
      label: 'Прокси…',
      click: () => {
        if(proxyModule) {
          proxyModule.openWindow();
        }
      }
    },
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
  appBaseURL = baseURL;
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

// * Telegram fix utility: the working copy lives OUTSIDE the app, in
// * `%LOCALAPPDATA%\Duckgram -fix` — the app dir may live in Program Files and
// * the bat needs a writable place for its backup/lists. The bundled source
// * sits in `resources/app/Duckgram -fix` and is copied over on demand. Flow,
// * in order:
// *   1. `.tggfx` in the app folder -> the fix was already handled on this
// *      computer: no window, nothing is touched;
// *   2. no `.tggfx` -> show the window "вы уже пользовались фиксом на этом
// *      компьютере или ещё нет?";
// *   3. after any answer the fix folder is checked: the `.bat` is there ->
// *      done; missing -> the bundle is copied from the app;
// *   4. answer "нет" -> launch `Duckgram-fix.bat` (own UAC elevation) and keep
// *      the splash up until it writes `.duck` (or the timeout passes); answer
// *      "да" -> nothing is launched;
// *   5. `.tggfx` is written to the app folder so the window never comes back.
// * Closing the window (Esc) writes nothing: the question comes back on the
// * next launch.
const FIX_SOURCE_DIR = path.join(APP_ROOT, 'Duckgram -fix');
const FIX_BAT_NAME = 'Duckgram-fix.bat';
// * `.tggfx` stub-marker: next to the exe in a build, in the project root in
// * dev. Its presence alone suppresses the window.
const FIX_MARKER_FILE = path.join(app.isPackaged ? path.dirname(process.execPath) : APP_ROOT, '.tggfx');
const FIX_WAIT_TIMEOUT = 10 * 60 * 1000; // give the fix time to finish
// * machine state must not travel with the copy: `.duck` = "already applied",
// * `backup/` holds the previous state
const FIX_COPY_SKIP = new Set(['.duck', 'backup', '.gitattributes']);

// * `app.getPath('localAppData')` throws in this Electron build, so
// * %LOCALAPPDATA% is the source of truth; Roaming's sibling `Local` is the
// * fallback.
function getFixDir() {
  let local = process.env.LOCALAPPDATA;
  if(!local) {
    try {
      local = path.join(path.dirname(app.getPath('appData')), 'Local');
    } catch(e) {
      return '';
    }
  }
  return path.join(local, 'Duckgram -fix');
}

function installFix(fixDir) {
  try {
    if(!fs.existsSync(path.join(FIX_SOURCE_DIR, FIX_BAT_NAME))) {
      console.error('[Duckgram] bundled fix is missing:', FIX_SOURCE_DIR);
      return false;
    }
    fs.cpSync(FIX_SOURCE_DIR, fixDir, {
      recursive: true,
      filter: (src) => !FIX_COPY_SKIP.has(path.basename(src))
    });
    return true;
  } catch(e) {
    console.error('[Duckgram] failed to install the fix into AppData:', e);
    return false;
  }
}

// * Best effort: the app folder may be read-only (Program Files) — then the
// * window simply comes back on the next launch.
function writeFixMarker() {
  try {
    fs.writeFileSync(FIX_MARKER_FILE, '');
  } catch(e) {}
}

// * The folder check that runs after the window is answered: `.bat` present ->
// * done, missing -> copy the bundle from the app. Returns whether the fix is
// * ready to be launched.
function ensureFixCopied() {
  const fixDir = getFixDir();
  if(!fixDir) {
    return false;
  }
  if(fs.existsSync(path.join(fixDir, FIX_BAT_NAME))) {
    return true;
  }
  console.log('[Duckgram] fix is missing, copying it from the bundle...');
  return installFix(fixDir);
}

// * The one and only gate: no `.tggfx` in the app folder -> the window is
// * shown. Resolves to `true` when the fix must NOT be launched (already used,
// * skipped by env, or the window was dismissed).
function openBrowserExtensionHelp() {
  const dir = path.join(__dirname, '..', 'browser-extension');
  if(fs.existsSync(dir)) {
    shell.openPath(dir);
  }
  dialog.showMessageBox({
    type: 'info',
    title: 'Duckgram',
    message: 'Расширение для браузера',
    detail: 'Оно открывает ссылки t.me сразу в Duckgram, без загрузки страницы.\n\n' +
      '1. В браузере откройте chrome://extensions (в Яндексе — browser://extensions).\n' +
      '2. Включите «Режим разработчика».\n' +
      '3. Нажмите «Загрузить распакованное расширение».\n' +
      '4. Выберите папку browser-extension, которую мы только что открыли.\n\n' +
      'При первом переходе браузер спросит «Открыть Duckgram?» — поставьте «Всегда разрешать».',
    buttons: ['Понятно'],
    noLink: true
  });
}

function askAboutFixOnce() {
  return new Promise((resolve) => {
    if(process.env.DUCKGRAM_SKIP_FIX) {
      return resolve(true);
    }
    if(fs.existsSync(FIX_MARKER_FILE)) {
      return resolve(true);
    }

    dialog.showMessageBox({
      type: 'warning',
      title: 'Duckgram',
      message: 'Вы уже пользовались фиксом на этом компьютере или ещё нет?',
      detail: 'Если нет — фикс будет скопирован и запущен автоматически.\n' +
        'После ответа программа проверит папку с фиксом и скопирует её, если её нет.',
      buttons: ['Да, уже пользовался', 'Нет, ещё нет', 'Расширение для браузера'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    }).then((result) => {
      if(result.canceled) {
        // * dismissed (Esc / close): nothing is written, the window comes back
        // * on the next launch and nothing is launched now
        return resolve(true);
      }
      if(result.response === 2) {
        openBrowserExtensionHelp();
        askAboutFixOnce().then(resolve);
        return;
      }
      const used = result.response === 0;
      ensureFixCopied();
      writeFixMarker();
      resolve(used);
    }).catch(() => {
      // * a broken window must not block the app
      resolve(true);
    });
  });
}

// * The launch step: only for the answer "нет". The bat re-launches itself
// * elevated for UAC, so the process cannot be waited on — poll the `.duck`
// * marker it writes when done, with a hard timeout.
function runFixIfNeeded(fixUsed) {
  return new Promise((resolve) => {
    if(process.env.DUCKGRAM_SKIP_FIX || fixUsed) {
      return resolve();
    }
    const fixDir = getFixDir();
    if(!fixDir || !ensureFixCopied()) {
      return resolve();
    }

    const fixBat = path.join(fixDir, FIX_BAT_NAME);
    const fixDuck = path.join(fixDir, '.duck');
    console.log('[Duckgram] launching the fix...');
    try {
      spawn('cmd.exe', ['/c', fixBat], {
        cwd: fixDir,
        detached: true,
        stdio: 'ignore'
      });
    } catch(e) {
      console.error('[Duckgram] failed to launch the fix:', e);
      return resolve();
    }

    const deadline = Date.now() + FIX_WAIT_TIMEOUT;
    const poll = setInterval(() => {
      if(fs.existsSync(fixDuck) || Date.now() > deadline) {
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
  app.on('second-instance', (event, argv) => {
    const link = extractTgLink(argv);
    if(link) {
      openTgLink(link);
    } else {
      showMainWindow();
    }
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    openTgLink(url);
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId('app.duckgram.desktop');

    // * регистрируем tg:// как наш протокол: ссылки открываются в Duckgram
    if(process.defaultApp) {
      if(process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('tg', process.execPath, [path.resolve(process.argv[1])]);
      }
    } else {
      app.setAsDefaultProtocolClient('tg');
    }

    openTgLink(extractTgLink(process.argv));

    tgLinksEnabled = readJsonFile(tgModeFile(), {enabled: true}).enabled !== false;
    applyTgLinksState();
    setInterval(ensureTgHandler, 15000).unref();
    app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

    // * The `.tggfx` window comes first: no marker -> ask whether the fix was
    // * used here; "нет" launches it below, right after the splash is up.
    const fixUsed = await askAboutFixOnce();

    createSplashWindow();
    dbg('MAIN splash created, startServer following');

    // Keep the splash up until the fix finishes (`.duck` marker or timeout).
    await runFixIfNeeded(fixUsed);

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

    // * Dogram Login Bot: renderer сообщил о реальном входе в аккаунт.
    ipcMain.handle('duckgram-login', async (event, payload) => {
      const data = payload && typeof payload === 'object' ? payload : {};
      const userId = Number(data.userId);

      if(!Number.isSafeInteger(userId) || userId <= 0) {
        return {ok: false, error: 'bad userId'};
      }

      const cfg = readLoginNotifyConfig();
      if(!cfg.enabled) {
        return {ok: true, skipped: true};
      }
      if(!cfg.secret) {
        dbg('[login-notify] secret пуст, отправка пропущена');
        return {ok: false, error: 'secret is empty'};
      }

      const now = Date.now();
      const last = loginNotifyLast.get(userId) || 0;
      const dedupeMs = Math.max(10, Number(cfg.dedupeSeconds) || 120) * 1000;
      if(now - last < dedupeMs) {
        return {ok: true, duplicate: true};
      }
      loginNotifyLast.set(userId, now);

      const result = await postJson(cfg.url, {
        userId,
        username: String(data.username || '').slice(0, 64),
        name: String(data.name || '').slice(0, 128),
        device: String(data.device || 'Dogram / Windows').slice(0, 200),
        client: 'Duckgram ' + app.getVersion()
      }, {'x-dogram-secret': cfg.secret});

      dbg('[login-notify] userId=' + userId + ' result=' + JSON.stringify(result));
      return result;
    });

    globalShortcut.register(GLOBAL_SHORTCUT, toggleMainWindow);

    // * быстрый доступ к настройкам прокси и с экрана входа
    globalShortcut.register('Control+Alt+P', () => {
      if(proxyModule) {
        proxyModule.openWindow();
      }
    });

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

      // * ссылки t.me открываем через штатный менеджер чатов
      patchImManagerBridge();

      // * сначала поднимаем мост: от него зависит и подмена транспорта, и URL
      if(proxyModule) {
        await proxyModule.prepare();
      }

      indexHtml = injectLoginNotify(indexHtml);

      if(proxyModule) {
        indexHtml = proxyModule.injectHtml(indexHtml);
      }

      startServer((port) => {
        const baseUrl = 'http://127.0.0.1:' + port;
        if(proxyModule) {
          proxyModule.setBaseUrl(baseUrl);
        }
        createWindow(baseUrl);
        if(proxyModule) {
          proxyModule.autoOpenIfNeeded();
        }
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
