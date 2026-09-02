const {chromium} = require('@playwright/test');

(async() => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const page = browser.contexts()[0].pages().find(p => p.url().includes('127.0.0.1'));
  const logs = [];
  page.on('console', m => { if(['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));

  // open Saved Messages
  await page.evaluate(() => {
    const target = [...document.querySelectorAll('.row-title')].find(e => e.textContent.trim() === 'Избранное');
    const row = target.closest('.row') || target.parentElement;
    row.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
  });
  await page.waitForTimeout(1500);

  // instrument
  await page.evaluate(() => {
    window.__log = [];
    const push = (...a) => window.__log.push(a.join(' '));
    const OrigAC = window.AudioContext;
    window.AudioContext = class extends OrigAC {
      constructor(opts) {
        super(opts);
        push('AudioContext created state=' + this.state + ' rate=' + this.sampleRate + ' opts=' + JSON.stringify(opts || {}));
        this.addEventListener('statechange', () => push('  ctx state -> ' + this.state));
      }
    };
    push('instrumentation ready');
  });

  // click record
  await page.evaluate(() => {
    const b = document.querySelector('.chat-input .btn-send');
    b.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
  });
  await page.waitForTimeout(1200);

  const res = await page.evaluate(() => ({
    log: window.__log,
    inputClasses: document.querySelector('.chat-input')?.className,
    hasCancel: !!document.querySelector('.btn-record-cancel'),
    chatInputHtmlLen: document.querySelector('.chat-input')?.innerHTML.length
  }));
  console.log('AUDIO LOG:', JSON.stringify(res.log, null, 1));
  console.log('INPUT CLASSES:', res.inputClasses);
  console.log('HAS CANCEL BTN:', res.hasCancel);
  console.log('CONSOLE (' + logs.length + '):');
  logs.forEach(l => console.log(' ', l.slice(0, 250)));
  await browser.close();
})().catch(e => {
  console.error('DIAG FAILED:', e.message);
  process.exit(1);
});
