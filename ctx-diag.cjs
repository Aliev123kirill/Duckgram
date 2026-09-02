const {chromium} = require('@playwright/test');

(async() => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const page = browser.contexts()[0].pages().find(p => p.url().includes('127.0.0.1'));
  const res = await page.evaluate(async() => {
    const out = {};
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});
      const ctx = new AudioContext({sampleRate: 48000});
      out.ctxStateAfterCreate = ctx.state;
      if(ctx.state === 'suspended') {
        try {
          await ctx.resume();
          out.resumeOk = true;
        } catch(e) {
          out.resumeError = e.name + ': ' + e.message;
        }
      }
      out.ctxStateFinal = ctx.state;
      let msgCount = 0;
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob(
        [`registerProcessor('d-count', class extends AudioWorkletProcessor { process(inputs){ if(inputs[0] && inputs[0][0] && inputs[0][0].length) { this.port.postMessage(inputs[0][0].length); } return true; } });`],
        {type: 'application/javascript'}
      )));
      const node = new AudioWorkletNode(ctx, 'd-count');
      node.port.onmessage = () => msgCount++;
      ctx.createMediaStreamSource(stream).connect(node);
      await new Promise(r => setTimeout(r, 400));
      out.workletMsgsIn400ms = msgCount;
      stream.getTracks().forEach(t => t.stop());
      node.disconnect();
      await ctx.close();
      return out;
    } catch(e) {
      return {...out, FAILED: e.name + ': ' + e.message};
    }
  });
  console.log(JSON.stringify(res, null, 2));
  await browser.close();
})().catch(e => {
  console.error('DIAG FAILED:', e.message);
  process.exit(1);
});
