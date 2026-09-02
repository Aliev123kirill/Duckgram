const {chromium} = require('@playwright/test');

(async() => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const page = browser.contexts()[0].pages().find(p => p.url().includes('127.0.0.1'));
  const logs = [];
  page.on('console', m => { if(['error'].includes(m.type())) logs.push('console: ' + m.text()); });
  page.on('pageerror', e => logs.push('PAGEERROR: ' + e.message));

  const state0 = await page.evaluate(() => ({
    stillRecording: !!document.querySelector('.voice-recording-panel--recording'),
    inputClasses: document.querySelector('.chat-input')?.className
  }));
  console.log('BEFORE:', JSON.stringify(state0));
  if(!state0.stillRecording) {
    console.log('not stuck - starting fresh recording');
    await page.evaluate(() => document.querySelector('.chat-input .btn-send')
      .dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true})));
    await page.waitForTimeout(1500);
    const st = await page.evaluate(() => ({
      rec: !!document.querySelector('.voice-recording-panel--recording'),
      timer: document.querySelector('.voice-recording-timer')?.textContent,
      now: Date.now()
    }));
    console.log('RECORDING:', JSON.stringify(st));
  }

  // instrument flush + close before clicking send
  await page.evaluate(() => {
    window.__log = [];
    const push = m => window.__log.push(m + ' @' + (Date.now() % 100000));
    const of = AudioEncoder.prototype.flush;
    AudioEncoder.prototype.flush = function() {
      push('flush ENTER state=' + this.state);
      const p = of.call(this);
      p.then(() => push('flush RESOLVED'), e => push('flush REJECTED ' + e.name + ': ' + e.message));
      return p;
    };
    const oc = AudioEncoder.prototype.close;
    AudioEncoder.prototype.close = function() {
      push('close called state=' + this.state);
      return oc.call(this);
    };
    push('instrumented');
  });

  await page.evaluate(() => document.querySelector('.chat-input .btn-send')
    .dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true})));
  await page.waitForTimeout(4000);

  const res = await page.evaluate(() => ({
    log: window.__log,
    panelAfter: !!document.querySelector('.voice-recording-panel--recording'),
    inputClasses: document.querySelector('.chat-input')?.className,
    bubbles: document.querySelectorAll('.bubbles .bubble').length,
    lastBubbleHasAudio: !!([...document.querySelectorAll('.bubbles .bubble')].pop()?.querySelector('audio'))
  }));
  console.log('LOG:', JSON.stringify(res.log, null, 1));
  console.log('AFTER SEND CLICK:', JSON.stringify({panel: res.panelAfter, bubbles: res.bubbles, audio: res.lastBubbleHasAudio}));
  console.log('INPUT:', res.inputClasses);
  logs.forEach(l => console.log(l.slice(0, 250)));
  await browser.close();
})().catch(e => {
  console.error('DIAG FAILED:', e.message);
  process.exit(1);
});
