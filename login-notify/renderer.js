/**
 * ============================================================================
 *  Dogram Login Notify — скрипт внутри интерфейса Duckgram (renderer)
 * ============================================================================
 *
 *  Задача: заметить РЕАЛЬНЫЙ вход в аккаунт и отправить событие в main-процесс,
 *  который перешлёт его на сервер бота (POST /api/login).
 *
 *  Ничего в dist не меняется: файл подключается из index.html в памяти.
 *
 *  Как определяется вход:
 *    - tweb хранит состояние в модуле langPack-*.js, экспорт с методом
 *      getMyId(); путь к модулю передаёт main.js через
 *      window.__DUCKGRAM_LOGIN_NOTIFY_MODULE;
 *    - настоящий вход (номер + код, QR, регистрация) не имеет аккаунта,
 *      пока человек не авторизуется: getMyId() остаётся 0 всё время, пока
 *      открыт экран входа;
 *    - обычный запуск клиента с сохранённой сессией: id появляется почти
 *      сразу (загрузка состояния), экрана входа по сути нет.
 *
 *  Поэтому входом считается: аккаунта не было дольше AUTH_SCREEN_TICKS,
 *  а затем он появился. Просто открытие клиента уведомление НЕ отправляет.
 *  Флаг «экран входа был» хранится в sessionStorage: tweb перезагружает
 *  интерфейс после входа, и без этого событие терялось бы.
 * ============================================================================
 */

const LAST_USER_KEY = 'duckgram:loginNotify:lastUserId';
const AUTH_INTENT_KEY = 'duckgram:loginNotify:authIntent';
const TICK_MS = 1000;
// * сколько тиков подряд не должно быть аккаунта, чтобы счесть это экраном входа
const AUTH_SCREEN_TICKS = 8;

let rootScope = null;
let sawAuthorized = false;
// * сколько тиков подряд аккаунта нет: долго — значит открыт экран входа
let unauthorizedTicks = 0;
// * экран входа был в этом окне: следующий вход — настоящая авторизация
let authIntent = false;
let loggedProfile = false;
let lastSentAt = 0;
let lastSentId = 0;
// * подписка на бота: функция ставится из boot(), когда интерфейс tweb готов
let subscribeBotHandler = null;
let subscribedThisRun = false;

function log(...args) {
    try {
        console.log('[login-notify]', ...args);
    } catch (_) {
        /* консоль может быть недоступна */
    }
}

function deviceLabel() {
    const ua = String(navigator.userAgent || '');
    const match = ua.match(/Windows NT [\d.]+/);
    return 'Dogram / ' + (match ? match[0] : 'desktop');
}

function currentUserId() {
    try {
        const value = rootScope && rootScope.getMyId ? rootScope.getMyId() : 0;
        const id = Number(value);
        return Number.isSafeInteger(id) && id > 0 ? id : 0;
    } catch (_) {
        return 0;
    }
}

/**
 * Имя и username своего аккаунта. API tweb меняется между версиями, поэтому
 * пробуем несколько известных мест и в любом случае возвращаем строки.
 */
function myProfile(id) {
    const managers = rootScope && rootScope.managers;
    const candidates = [];

    try { if (managers && managers.appUsersManager) candidates.push(managers.appUsersManager); } catch (_) {}
    try { if (managers && managers.apiManagerProxy) candidates.push(managers.apiManagerProxy); } catch (_) {}

    for (const manager of candidates) {
        try {
            const user = manager && typeof manager.getUser === 'function' ? manager.getUser(id) : null;
            if (!user) continue;

            const name = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
            if (!name && !user.username) continue;

            return { name, username: String(user.username || '') };
        } catch (_) {
            /* пробуем следующее место */
        }
    }

    return { name: '', username: '' };
}

/** Интерфейс уже показывает чаты, а не экран входа. */
function isAuthorized() {
    if (document.body.classList.contains('has-auth-pages')) return false;

    const chats = document.getElementById('page-chats');
    if (chats && chats.style.display === 'none') return false;

    return true;
}

function storedUserId() {
    try {
        return Number(localStorage.getItem(LAST_USER_KEY)) || 0;
    } catch (_) {
        return 0;
    }
}

function storeUserId(id) {
    try {
        localStorage.setItem(LAST_USER_KEY, String(id));
    } catch (_) {
        /* приватный режим и т.п. — не критично */
    }
}

function clearStoredUserId() {
    try {
        localStorage.removeItem(LAST_USER_KEY);
    } catch (_) {
        /* не критично */
    }
}

// * Флаг «человек был на экране входа». sessionStorage переживает
// * перезагрузку интерфейса (tweb перезагружает страницу после входа),
// * но очищается при закрытии клиента.
function markAuthIntent() {
    try {
        sessionStorage.setItem(AUTH_INTENT_KEY, '1');
    } catch (_) {
        /* не критично */
    }
}

function storedAuthIntent() {
    try {
        return sessionStorage.getItem(AUTH_INTENT_KEY) === '1';
    } catch (_) {
        return false;
    }
}

function clearAuthIntent() {
    try {
        sessionStorage.removeItem(AUTH_INTENT_KEY);
    } catch (_) {
        /* не критично */
    }
}

async function sendLogin(id) {
    const api = window.electronHelpers;
    if (!api || typeof api.notifyLogin !== 'function') {
        log('electronHelpers.notifyLogin недоступен — обновите preload.js');
        return;
    }

    const now = Date.now();
    if (id === lastSentId && now - lastSentAt < 60_000) return;

    lastSentId = id;
    lastSentAt = now;

    const profile = myProfile(id);
    log('профиль аккаунта:', JSON.stringify(profile));

    try {
        const result = await api.notifyLogin({
            userId: id,
            name: profile.name,
            username: profile.username,
            device: deviceLabel(),
        });
        log('событие входа отправлено userId=' + id, result);

        // * Сервер сказал, что бот пользователю ещё не знаком: писать первым
        // * Telegram не даёт, поэтому клиент сам отправляет боту /start —
        // * после этого уведомления о входах доставляются сразу.
        if (result && result.userHasBot === false) {
            log('бот не запущен у пользователя — нужна подписка');
            if (subscribeBotHandler) {
                subscribeBotHandler();
            }
        }
    } catch (error) {
        log('ошибка отправки события входа:', error && error.message);
    }
}

function tick() {
    const authorized = isAuthorized();
    const id = currentUserId();

    // * Аккаунта нет: это либо загрузка состояния, либо экран входа.
    // * Если так дольше AUTH_SCREEN_TICKS — человек именно авторизуется.
    if (!authorized || !id) {
        unauthorizedTicks += 1;
        if (unauthorizedTicks >= AUTH_SCREEN_TICKS && !authIntent) {
            authIntent = true;
            markAuthIntent();
            log('экран входа дольше ' + AUTH_SCREEN_TICKS + ' с — ждём авторизации');
        }

        // * Выход из аккаунта: метку стираем, чтобы следующий вход снова
        // * считался новым.
        if (sawAuthorized) {
            sawAuthorized = false;
            clearStoredUserId();
            log('выход из аккаунта — метка входа сброшена');
        }
        return;
    }

    sawAuthorized = true;
    unauthorizedTicks = 0;

    if (!loggedProfile) {
        loggedProfile = true;
        log('профиль аккаунта userId=' + id + ':', JSON.stringify(myProfile(id)));
    }

    const previous = storedUserId();
    const realLogin = authIntent || (previous > 0 && previous !== id);

    // * Просто открыли клиент с сохранённой сессией — это не вход.
    if (!realLogin) return;

    const reason = authIntent ? 'вход' : 'смена аккаунта';
    authIntent = false;
    clearAuthIntent();

    // Запоминаем ДО отправки, чтобы не отправить дважды на следующем тике.
    storeUserId(id);
    log(
        reason + ' userId=' + id +
        (previous ? ' (было ' + previous + ')' : '')
    );
    sendLogin(id);
}

async function boot() {
    const modulePath = window.__DUCKGRAM_LOGIN_NOTIFY_MODULE;
    if (!modulePath) {
        log('main.js не передал путь к модулю состояния');
        return;
    }

    try {
        const module = await import(modulePath);
        rootScope = Object.values(module).find(
            (value) => value && typeof value.getMyId === 'function' && typeof value.addEventListener === 'function'
        ) || null;

        if (!rootScope) {
            log('в модуле не найден rootScope');
            return;
        }

        // * переход по ссылке t.me/tg:// внутри клиента (вызывает main.js)
        // * настоящий appImManager живёт в чанке buttonMenu-*.js, а не в
        // * rootScope.managers (там лежат только acknowledged и all)
        let openManager = null;

        function looksLikeAppImManager(value) {
            try {
                return !!value
                    && typeof value.openUsername === 'function'
                    && typeof value.setInnerPeer === 'function';
            } catch (error) {
                return false;
            }
        }

        function rememberManager(value) {
            openManager = value;
            return value;
        }

        function managersFromRootScope() {
            const result = [];
            try {
                const managers = (rootScope && rootScope.managers) || {};
                result.push(managers.appImManager, managers.imManager);
                if (managers.all && typeof managers.all === 'object') {
                    try {
                        result.push(...Object.values(managers.all));
                    } catch (error) {
                        log('managers.all недоступен:', error && error.message);
                    }
                }
            } catch (error) {
                log('managers недоступны:', error && error.message);
            }
            try {
                result.push(rootScope && rootScope.appImManager);
            } catch (error) {
                /* игнорируем */
            }
            return result;
        }

        function loadedChunkUrls() {
            const urls = [];
            try {
                for (const entry of performance.getEntriesByType('resource')) {
                    const name = entry && entry.name ? String(entry.name) : '';
                    if (/buttonMenu-[^/]+\.js(\?|$)/.test(name)) {
                        urls.push(name);
                    }
                }
            } catch (error) {
                log('resource timing недоступен:', error && error.message);
            }
            return urls;
        }

        function withTimeout(promise, ms, label) {
            let timer = 0;
            return Promise.race([
                Promise.resolve(promise),
                new Promise((resolve, reject) => {
                    timer = setTimeout(() => {
                        reject(new Error(label + ': таймаут'));
                    }, ms);
                })
            ]).finally(() => clearTimeout(timer));
        }

        /** Имя бота: main.js передаёт его из login-notify/config.json. */
        function botUsername() {
            const fromMain = String(window.__DUCKGRAM_LOGIN_NOTIFY_BOT || '')
                .trim()
                .replace(/^@/, '');
            return fromMain || 'DUCKGRAM_NOTIFY_bot';
        }

        function peerIdOf(user) {
            const id = user && user.id;
            if (typeof id === 'number' && typeof id.toPeerId === 'function') {
                return id.toPeerId(false);
            }
            return Number(id) || 0;
        }

        /**
         * Отправляет боту /start от имени пользователя — так же, как это
         * делает обычный клиент Telegram, когда человек открывает чат с ботом.
         * Без этого бот не может написать первым.
         */
        async function subscribeBot() {
            if (subscribedThisRun) return;
            subscribedThisRun = true;

            try {
                await withTimeout(findOpenManager(), 5000, 'findOpenManager')
                    .catch((error) => {
                        log('подписка: поиск менеджера прерван:', error && error.message);
                        return null;
                    });

                const managers = (openManager && openManager.managers) || null;
                if (!managers) {
                    log('подписка: managers недоступны');
                    return;
                }

                const users = managers.appUsersManager;
                const messages = managers.appMessagesManager;
                if (!users || typeof users.resolveUsername !== 'function'
                    || !messages || typeof messages.sendText !== 'function') {
                    log('подписка: appUsersManager/appMessagesManager не найдены');
                    return;
                }

                const username = botUsername();
                const user = await withTimeout(
                    users.resolveUsername(username),
                    8000,
                    'resolveUsername'
                );

                const peerId = peerIdOf(user);
                if (!peerId) {
                    log('подписка: не удалось получить peerId бота');
                    return;
                }

                await withTimeout(
                    messages.sendText({ peerId, text: '/start' }),
                    8000,
                    'sendText'
                );
                log('подписка: команда /start отправлена боту @' + username);
            } catch (error) {
                log('подписка: ошибка:', error && error.message);
            }
        }

        subscribeBotHandler = () => {
            subscribeBot().catch((error) => {
                log('подписка: не запустилась:', error && error.message);
            });
        };

        async function findOpenManager() {
            log('поиск менеджера: старт');
            if (looksLikeAppImManager(openManager)) {
                log('менеджер из кеша');
                return true;
            }
            const bridged = window.__duckgramAppImManager;
            log('мост в window:', bridged ? typeof bridged : 'нет');
            if (looksLikeAppImManager(bridged)) {
                log('appImManager взят из window');
                rememberManager(bridged);
                return true;
            }
            const chunkUrls = loadedChunkUrls();
            log('чанков buttonMenu найдено:', chunkUrls.length);
            for (const url of chunkUrls) {
                try {
                    const chunk = await withTimeout(import(url), 3000, 'import');
                    log('чанк прочитан:', String(url).split('/').pop());
                    const names = Object.keys(chunk);
                    log('экспортов в чанке:', names.length);
                    for (const name of names) {
                        let value = null;
                        try {
                            value = chunk[name];
                        } catch (error) {
                            continue;
                        }
                        try {
                            if (looksLikeAppImManager(value && value.appImManager)) {
                                log('appImManager найден в экспорте чанка:', name);
                                rememberManager(value.appImManager);
                                return true;
                            }
                        } catch (error) {
                            /* экспорт без appImManager */
                        }
                        if (looksLikeAppImManager(value)) {
                            log('appImManager найден в чанке:', name);
                            rememberManager(value);
                            return true;
                        }
                    }
                } catch (error) {
                    log('чанк не загрузился:', url, error && error.message);
                }
            }
            log('в чанке не найден, смотрю rootScope');
            const candidates = managersFromRootScope();
            log('кандидатов из rootScope:', candidates.length);
            for (const value of candidates) {
                if (looksLikeAppImManager(value)) {
                    log('appImManager найден в rootScope');
                    rememberManager(value);
                    return true;
                }
            }
            return false;
        }

        window.__duckgramOpenLink = (url) => {
            log('запрос перехода:', url);
            try {
                navigateToLink(url).catch((error) => {
                    log('переход не удался:', error && error.message);
                });
            } catch (error) {
                log('переход не запустился:', error && error.message);
            }
            return true;
        };

        // * переход выполняем в фоне: main.js не должен ждать ответа
        async function navigateToLink(url) {
            let username = '';
            try {
                const path = decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ''));
                username = path.split('/')[0] || '';
            } catch (error) {
                log('разбор ссылки ошибка:', error && error.message);
            }

            await withTimeout(findOpenManager(), 5000, 'findOpenManager')
                .catch((error) => {
                    log('поиск менеджера прерван:', error && error.message);
                    return null;
                });
            const manager = openManager;
            if (manager && username) {
                try {
                    await withTimeout(manager.openUsername({userName: '@' + username}), 6000, 'openUsername');
                    log('чат открыт по username:', username);
                    return;
                } catch (error) {
                    log('openUsername ошибка:', error && error.message);
                }
            }
            if (manager) {
                try {
                    await withTimeout(manager.openUrl(url), 6000, 'openUrl');
                    log('ссылка открыта через openUrl:', url);
                    return;
                } catch (error) {
                    log('openUrl ошибка:', error && error.message);
                }
            }

            if (username) {
                try {
                    const hash = '#/im?p=@' + username;
                    if (location.hash !== hash) {
                        location.hash = hash;
                        log('переход по хешу:', hash);
                    }
                    return;
                } catch (error) {
                    log('hash переход ошибка:', error && error.message);
                }
            }
            return false;
        }

        // Событие tweb присылает при авторизации; просто ускоряем проверку.
        rootScope.addEventListener('user_auth', () => {
            setTimeout(tick, 0);
            setTimeout(tick, 500);
            setTimeout(tick, 2000);
        });

        try {
            const managers = rootScope.managers || {};
            const withUrl = Object.keys(managers).filter((key) => {
                try { return managers[key] && typeof managers[key].openUrl === 'function'; } catch (e) { return false; }
            });
            log('rootScope keys:', Object.keys(rootScope).join(','));
            log('managers keys:', Object.keys(managers).join(','));
            log('managers with openUrl:', withUrl.join(','));
        } catch (error) {
            log('inspect error:', error && error.message);
        }
        log('хук установлен, модуль:', modulePath);
        // * экран входа, показанный до перезагрузки интерфейса, не теряем:
        // * tweb перезагружает страницу после авторизации
        authIntent = storedAuthIntent();
        if (authIntent) {
            log('в этом окне уже показывался экран входа');
        }
        setInterval(tick, TICK_MS);
        tick();
    } catch (error) {
        log('не удалось загрузить модуль состояния:', error && error.message);
    }
}

boot();
