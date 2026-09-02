const {chromium} = require('@playwright/test');

(async() => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
  const page = browser.contexts()[0].pages().find(p => p.url().includes('127.0.0.1'));
  const res = await page.evaluate(async() => {
    const stages = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio: true});
      stages.push('1 gum OK');
      const ctx = new AudioContext({sampleRate: 48000});
      const src = ctx.createMediaStreamSource(stream);
      stages.push('2 ctx+src OK rate=' + ctx.sampleRate);
      const code = `registerProcessor('t-diag', class extends AudioWorkletProcessor { process(inputs){ return true; } });`;
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], {type: 'application/javascript'})));
      stages.push('3 addModule OK');
      const node = new AudioWorkletNode(ctx, 't-diag');
      src.connect(node);
      stages.push('4 worklet node OK');
      const config = {codec: 'opus', sampleRate: 48000, numberOfChannels: 1, bitrate: 32000};
      const sup = await AudioEncoder.isConfigSupported(config);
      stages.push('5 isConfigSupported=' + sup.supported);
      let chunks = 0;
      const enc = new AudioEncoder({output: () => chunks++, error: e => stages.push('ENC-ERR ' + e.name + ': ' + e.message)});
      enc.configure(config);
      const silence = new Float32Array(960);
      for(let i = 0; i < 10; ++i) {
        const ad = new AudioData({format: 'f32', sampleRate: 48000, numberOfFrames: 960, numberOfChannels: 1, timestamp: i * 20000, data: silence});
        enc.encode(ad);
        ad.close();
      }
      await enc.flush();
      enc.close();
      stages.push('6 encoded chunks=' + chunks);
      src.disconnect();
      stream.getTracks().forEach(t => t.stop());
      await ctx.close();
      return stages;
    } catch(e) {
      return [...stages, 'FAILED @' + (stages.length + 1) + ': ' + e.name + ': ' + e.message];
    }
  });
  console.log(JSON.stringify(res, null, 2));
  await browser.close();
})().catch(e => {
  console.error('DIAG FAILED:', e.message);
  process.exit(1);
});
