const RULE_ID = 1;
const FILTER = '^https?://(www\\.)?(t\\.me|telegram\\.me)/.*';

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

async function ensureRule() {
  try {
    const page = chrome.runtime.getURL('open.html');
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [RULE_ID],
      addRules: [
        {
          id: RULE_ID,
          priority: 2,
          action: {
            type: 'redirect',
            redirect: { regexSubstitution: page + '?u=\\0' }
          },
          condition: {
            regexFilter: FILTER,
            resourceTypes: ['main_frame']
          }
        }
      ]
    });
  } catch (e) {
    console.warn('[tg-links] правило не установлено:', e && e.message);
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  void ensureRule();
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') }, () => void chrome.runtime.lastError);
  }
});
chrome.runtime.onStartup.addListener(() => void ensureRule());
void ensureRule();

function redirectTab(tabId, rawUrl) {
  const link = toTgLink(rawUrl);
  if (!link) {
    return;
  }
  chrome.tabs.update(tabId, { url: link }, () => void chrome.runtime.lastError);
}

chrome.webNavigation.onBeforeNavigate.addListener(
  (details) => {
    if (details.frameId !== 0) {
      return;
    }
    redirectTab(details.tabId, details.url);
  },
  {
    url: [
      { hostEquals: 't.me' },
      { hostEquals: 'www.t.me' },
      { hostEquals: 'telegram.me' },
      { hostEquals: 'www.telegram.me' }
    ]
  }
);

chrome.webNavigation.onErrorOccurred.addListener(
  (details) => {
    if (details.frameId !== 0) {
      return;
    }
    redirectTab(details.tabId, details.url);
  },
  {
    url: [
      { hostEquals: 't.me' },
      { hostEquals: 'www.t.me' },
      { hostEquals: 'telegram.me' },
      { hostEquals: 'www.telegram.me' }
    ]
  }
);
