import type {Message} from '@layer';
import type {AutomaticSpeechRecognitionPipeline} from '@xenova/transformers';
import appDownloadManager from '@lib/appDownloadManager';
import getMediaFromMessage from '@appManagers/utils/messages/getMediaFromMessage';
import makeError from '@helpers/makeError';

// * Local speech-to-text fallback for non-Premium users. Runs on the main thread.
// * The library is loaded from CDN at runtime so it never enters the main bundle
// * and we don't have to bundle onnxruntime-web's UMD build + its .wasm assets.
// * Use the explicit file URL: it's the webpack ESM build (`self` exists in the
// * browser, unlike Node) and jsdelivr answers `application/javascript` for it.
const TRANSFORMERS_LIBRARY_URL: string = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';

// * Model id on the Hugging Face hub. `Xenova/whisper-tiny` (~40MB) is fast but
// * less accurate; `Xenova/whisper-base` (~150MB) is slower but more accurate.
export const LOCAL_WHISPER_MODEL = 'Xenova/whisper-tiny';
const LOCAL_WHISPER_CHUNK_LENGTH_S = 30;

// * Don't let a slow first-time model download wedge the spinner forever.
// * On timeout the call rejects, the UI resets, and the in-flight pipeline keeps
// * downloading in the background so the next attempt is fast.
const LOCAL_TRANSCRIPTION_TIMEOUT_MS = 2 * 60 * 1000;

let transformersModulePromise: Promise<typeof import('@xenova/transformers')> | undefined;
let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | undefined;

function getTransformersModule() {
  if(!transformersModulePromise) {
    transformersModulePromise = import(/* @vite-ignore */ TRANSFORMERS_LIBRARY_URL) as Promise<typeof import('@xenova/transformers')>;
  }

  return transformersModulePromise;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('LOCAL_WHISPER_TIMEOUT'));
    }, ms);
  });
  promise.then(() => clearTimeout(timer), () => clearTimeout(timer));
  return Promise.race([promise, timeout]);
}

async function getTranscriber() {
  if(!transcriberPromise) {
    const create = async() => {
      console.log('[transcribe] loading transformers.js from CDN');
      const {env, pipeline} = await getTransformersModule();
      console.log('[transcribe] transformers.js loaded, creating whisper pipeline (first run downloads the model ~13MB)');
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      // * Main-thread inference with threading disabled. onnxruntime-web defaults
      // * numThreads to min(4, ceil(hardwareConcurrency/2)) and then spawns
      // * `ort-wasm-threaded.worker.js` for the pthread pool — that file isn't
      // * shipped in the CDN bundle and resolves to a 404 inside the blob proxy
      // * worker, so session init hangs forever (the promise never rejects, which
      // * also defeats any `.catch` retry). numThreads=1 + proxy=false uses no
      // * workers at all and loads the plain simd wasm, which needs no
      // * SharedArrayBuffer and works over plain http too.
      env.backends.onnx.wasm.proxy = false;
      env.backends.onnx.wasm.numThreads = 1;

      const pipe = await pipeline('automatic-speech-recognition', LOCAL_WHISPER_MODEL);
      console.log('[transcribe] whisper pipeline ready');
      return pipe;
    };

    const promise = create();
    // * Don't cache a permanently-failed init: let the next attempt retry.
    promise.catch(() => {
      transcriberPromise = undefined;
    });

    transcriberPromise = promise;
  }

  return transcriberPromise;
}

export async function transcribeAudioLocally(blob: Blob): Promise<string> {
  const transcriber = await withTimeout(getTranscriber(), LOCAL_TRANSCRIPTION_TIMEOUT_MS);
  const url = URL.createObjectURL(blob);
  try {
    const result = await withTimeout(transcriber(url, {
      chunk_length_s: LOCAL_WHISPER_CHUNK_LENGTH_S,
      stride_length_s: LOCAL_WHISPER_CHUNK_LENGTH_S / 6
    }), LOCAL_TRANSCRIPTION_TIMEOUT_MS);
    const output = Array.isArray(result) ? result : [result];
    return output.map((chunk) => chunk.text || '').join(' ').trim();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function transcribeMessageLocally(message: Message.message): Promise<string> {
  const media = getMediaFromMessage(message, true);
  if(!media || media._ !== 'document' || (media.type !== 'voice' && media.type !== 'round')) {
    throw makeError('MSG_VOICE_MISSING');
  }

  const blob = await withTimeout(appDownloadManager.downloadMedia({media}), LOCAL_TRANSCRIPTION_TIMEOUT_MS);
  return transcribeAudioLocally(blob);
}
