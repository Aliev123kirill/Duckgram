import {copyFileSync, mkdirSync, readdirSync, statSync} from 'fs';
import {join} from 'path';

// vite.config.ts sets `copyPublicDir: false`, so the build never copies
// public/ into dist/. Almost everything the app loads at runtime goes through
// the bundler (hashed chunks), EXCEPT a handful of files that are fetched by
// their plain unhashed names - most importantly the Opus decode/WAV workers
// that sit on the voice message SEND path (opusDecodeController.ts). Without
// them, recording starts but the message never goes out.
const FILES = [
  'decoderWorker.min.js',
  'decoderWorker.min.wasm',
  'encoderWorker.min.js',
  'encoderWorker.min.wasm',
  'waveWorker.min.js'
];

for(const file of FILES) {
  copyFileSync(join('public', file), join('dist', file));
  console.log('copied', file);
}

function copyDirFiles(src, dst) {
  mkdirSync(dst, {recursive: true});
  for(const name of readdirSync(src)) {
    const srcPath = join(src, name);
    const dstPath = join(dst, name);
    if(statSync(srcPath).isFile()) {
      copyFileSync(srcPath, dstPath);
    }
  }
}

// Audio assets for notifications
copyDirFiles(join('public', 'assets', 'audio'), join('dist', 'assets', 'audio'));

// Duck image for saved messages avatar
copyDirFiles(join('public', 'assets', 'img'), join('dist', 'assets', 'img'));

console.log('copied assets');
