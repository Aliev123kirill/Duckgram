const {chromium} = require('@playwright/test');

(async() => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('127.0.0.1')) || ctx.pages()[0];
  console.log('PAGE URL:', page.url());
  const res = await page.evaluate(async() => {
    const out = {};
    out.secureContext = self.isSecureContext;
    out.userAgent = navigator.userAgent;
    out.hasMediaDevices = !!navigator.mediaDevices?.getUserMedia;
    out.audioEncoder = typeof AudioEncoder !== 'undefined';
    out.audioData = typeof AudioData !== 'undefined';
    out.audioWorkletNode = typeof AudioWorkletNode !== 'undefined';
    out.oggOpusMR = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus');
    try {
      const perm = await navigator.permissions.query({name: 'microphone'});
      out.micPermission = perm.state;
    } catch(e) {
      out.micPermission = 'query-failed: ' + e.message;
    }
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const mics = devs.filter(d => d.kind === 'audioinput');
      out.audioInputs = mics.length;
      out.labels = mics.map(d => d.label || '(no label)');
    } catch(e) {
      out.enumError = e.name + ': ' + e.message;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});
      out.gumOk = true;
      out.trackLabels = stream.getAudioTracks().map(t => t.label);
      out.trackSettings = stream.getAudioTracks()[0]?.getSettings();
      stream.getTracks().forEach(t => t.stop());
    } catch(e) {
      out.gumErrorName = e.name;
      out.gumErrorMsg = e.message;
      out.gumConstraint = e.constraint;
    }
    return out;
  });
  console.log(JSON.stringify(res, null, 2));
  await browser.close();
})().catch(e => {
  console.error('DIAG FAILED:', e.message);
  process.exit(1);
});
