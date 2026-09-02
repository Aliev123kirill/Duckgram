const {chromium} = require('@playwright/test');

(async() => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const page = browser.contexts()[0].pages().find(p => p.url().includes('127.0.0.1'));
  const logs = [];
  page.on('console', m => { if(['error'].includes(m.type())) logs.push('console: ' + m.text()); });
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));

  // wait for app mount
  await page.waitForSelector('.row-title', {timeout: 30000});
  // open Saved Messages if no input yet
  const hasInput = await page.evaluate(() => !!document.querySelector('.chat-input .btn-send'));
  if(!hasInput) {
    await page.evaluate(() => {
      const target = [...document.querySelectorAll('.row-title')].find(e => e.textContent.trim() === 'Избранное');
      const row = target.closest('.row') || target.parentElement;
      ['mousedown', 'mouseup', 'click'].forEach(type =>
        row.dispatchEvent(new MouseEvent(type, {bubbles: true, cancelable: true})));
    });
    for(let i = 0; i < 20; ++i) {
      await page.waitForTimeout(500);
      if(await page.evaluate(() => !!document.querySelector('.chat-input .btn-send'))) break;
    }
    await page.waitForSelector('.chat-input .btn-send', {timeout: 5000});
  }

  const clickSend = () => page.evaluate(() =>
    document.querySelector('.chat-input .btn-send').dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true})));

  const before = await page.evaluate(() => document.querySelectorAll('.bubbles .bubble').length);
  console.log('BUBBLES BEFORE:', before);

  await clickSend(); // start recording
  await page.waitForTimeout(1600);
  const mid = await page.evaluate(() => ({
    recording: !!document.querySelector('.voice-recording-panel--recording'),
    timer: document.querySelector('.voice-recording-timer')?.textContent,
    peaks: document.querySelectorAll('.live-waveform span, [class*="waveform"] *').length
  }));
  console.log('DURING:', JSON.stringify(mid));

  await clickSend(); // stop + send
  await page.waitForTimeout(4000);
  const after = await page.evaluate(() => {
    const bubbles = [...document.querySelectorAll('.bubbles .bubble')];
    const last = bubbles[bubbles.length - 1];
    return {
      bubbles: bubbles.length,
      panelGone: !document.querySelector('.voice-recording-panel--recording'),
      unlocked: !document.querySelector('.chat-input').classList.contains('is-recording'),
      lastIsVoice: !!last?.querySelector('audio'),
      lastClasses: last?.className.slice(0, 120)
    };
  });
  console.log('AFTER:', JSON.stringify(after));
  console.log('SENT OK:', after.bubbles > before && after.lastIsVoice ? 'YES ✓' : 'NO ✗');
  console.log('CONSOLE (' + logs.length + '):');
  logs.forEach(l => console.log(' ', l.slice(0, 250)));
  await browser.close();
})().catch(e => {
  console.error('DIAG FAILED:', e.message);
  process.exit(1);
});
