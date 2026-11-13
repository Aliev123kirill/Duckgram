function toTgLink(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (e) {
    return null;
  }

  if (!/^(t\.me|www\.t\.me|telegram\.me|www\.telegram\.me)$/i.test(url.hostname)) {
    return null;
  }

  const path = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  if (!path) {
    return 'tg://resolve';
  }

  if (path.startsWith('+')) {
    return 'tg://join?invite=' + encodeURIComponent(path.slice(1));
  }

  if (path.startsWith('s/')) {
    return null;
  }

  const parts = path.split('/');
  const domain = parts[0];
  if (!domain) {
    return null;
  }

  let link = 'tg://resolve?domain=' + encodeURIComponent(domain);
  if (parts[1] && /^\d+$/.test(parts[1])) {
    link += '&post=' + parts[1];
  }
  if (parts[2] && /^\d+$/.test(parts[2])) {
    link += '&comment=' + parts[2];
  }

  const single = url.searchParams.get('single');
  if (single) {
    link += '&single=' + encodeURIComponent(single);
  }

  return link;
}

function redirectToApp(rawUrl) {
  const link = toTgLink(rawUrl);
  if (!link) {
    return false;
  }
  location.replace(link);
  return true;
}

const params = new URLSearchParams(location.search);
const original = params.get('u') || '';
const tgLink = toTgLink(original);

const openBtn = document.getElementById('open');
const skipBtn = document.getElementById('skip');
const actions = document.getElementById('actions');
const target = document.getElementById('target');
const hint = document.getElementById('hint');

if (target) {
  target.textContent = original ? original.replace(/^https?:\/\//, '') : 't.me';
}

if (!tgLink) {
  if (actions) {
    actions.hidden = true;
  }
  if (hint) {
    hint.textContent = 'Эту ссылку расширение не перехватывает: веб-версия канала открывается в браузере как обычно.';
  }
} else {
  if (openBtn) {
    openBtn.addEventListener('click', () => void redirectToApp(original));
  }
  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      if (actions) {
        actions.hidden = true;
      }
      if (hint) {
        const p = document.createElement('p');
        p.className = 'stopped';
        p.textContent = 'Хорошо, ничего не открываем. Адрес сохранён выше — его можно скопировать.';
        hint.replaceWith(p);
      }
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      void redirectToApp(original);
    }
  });
  if (openBtn) {
    openBtn.focus();
  }
}
