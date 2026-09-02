import {readFileSync} from 'fs';
import {createTestClient, AccountSeed} from './harness';
import type {MethodDeclMap} from '@layer';

/**
 * Server-verified test for voice-message transcription.
 *
 * Prereq: `tmp/seed.json` (see README.md for the DevTools dump snippet) and
 * `.env.local` with VITE_API_ID / VITE_API_HASH.
 *
 * The test finds a real voice message in the account (via messages.searchGlobal
 * with the round-voice filter), then drives the full transcription pipeline:
 *
 *   appMessagesManager.transcribeAudio → messages.transcribeAudio
 *     → processLocalUpdate(updateTranscribedAudio)
 *     → onUpdateTranscribedAudio → resolves the waiting promise
 *
 * and prints the transcribed text. For non-Premium accounts the server answers
 * PREMIUM_ACCOUNT_REQUIRED — the test prints that error explicitly.
 *
 * Run:
 *   TG_API_TEST=1 TG_API_PROD_DC=1 TG_API_SEED=./tmp/seed.json \
 *     pnpm test src/tests/api/transcribe.test.ts -- --reporter=verbose --silent=false
 */

const ENABLED = process.env.TG_API_TEST === '1';
const seedPath = process.env.TG_API_SEED;

const describeOrSkip = ENABLED && seedPath ? describe : describe.skip;

describeOrSkip('mtproto transcription', () => {
  let client: Awaited<ReturnType<typeof createTestClient>>;

  beforeAll(async() => {
    const seed = JSON.parse(readFileSync(seedPath!, 'utf8')) as AccountSeed;
    client = await createTestClient({
      seed,
      testDc: process.env.TG_API_PROD_DC !== '1'
    });
  }, 60_000);

  afterAll(() => {
    client?.dispose();
  });

  test('transcribeAudio works against the real server', async() => {
    const api = client.apiManager;
    const managers = client.managers;

    await api.invokeApi('users.getUsers', {id: [{_: 'inputUserSelf'}]});

    let searchRes: any;
    try {
      searchRes = await api.invokeApi('messages.searchGlobal', {
        q: '',
        filter: {_: 'inputMessagesFilterRoundVoice'},
        min_date: 0,
        max_date: 0,
        offset_rate: 0,
        offset_peer: {_: 'inputPeerEmpty'},
        offset_id: 0,
        limit: 10
      });
    } catch(e: any) {
      console.log('[transcribe] searchGlobal failed, falling back to self search:', e?.type || e?.message);
      searchRes = await api.invokeApi('messages.search', {
        peer: {_: 'inputPeerSelf'},
        q: '',
        filter: {_: 'inputMessagesFilterRoundVoice'},
        min_date: 0,
        max_date: 0,
        offset_id: 0,
        add_offset: 0,
        limit: 10,
        max_id: 0,
        min_id: 0,
        hash: '0'
      });
    }

    const msgs = (searchRes?.messages || []) as any[];
    const users = searchRes?.users || [];
    const chats = searchRes?.chats || [];
    console.log('[transcribe] search', searchRes?._, 'messages:', msgs.length, 'users:', users.length, 'chats:', chats.length);

    if(!msgs.length) {
      console.log('[transcribe] SKIP — no voice messages found in this account');
      return;
    }

    const voice = msgs.find((m) => m?._ === 'message' && m?.peer_id) || msgs[0];
    if(!voice?.peer_id) {
      console.log('[transcribe] SKIP — first hit has no peer_id:', voice?._);
      return;
    }

    managers.appPeersManager.saveApiPeers({users, chats});

    const peerId = managers.appPeersManager.getPeerId(voice.peer_id);
    const channelId = (voice.peer_id as any).channel_id;
    const mid = managers.appMessagesIdsManager.generateMessageId(voice.id, channelId);

    const realInvoke = api.invokeApi.bind(api);
    let sawApiCall = false;
    (api as any).invokeApi = (method: keyof MethodDeclMap, params: any, opts?: any) => {
      const p = realInvoke(method, params, opts);
      if(method === 'messages.transcribeAudio') {
        sawApiCall = true;
        p.then((r: any) => console.log('[transcribe] ← server', r?._, JSON.stringify(r)),
               (e: any) => console.log('[transcribe] ← server ERR', e?.type, e?.message));
      }
      return p;
    };

    const fakeMessage: any = {
      ...voice,
      peerId,
      mid,
      pFlags: voice.pFlags || {}
    };

    console.log('[transcribe] transcribing mid=' + mid, 'peerId=' + peerId, 'serverId=' + voice.id, 'date=' + voice.date, 'duration=', voice.media?.document?.duration);

    const result = await managers.appMessagesManager.transcribeAudio(fakeMessage, true);

    console.log('[transcribe] final result:', JSON.stringify(result));
    expect(sawApiCall).toBe(true);
    expect(result?._).toBe('messages.transcribedAudio');
    if(!result?.pFlags?.pending) {
      console.log('[transcribe] TEXT:', result.text);
    }
  }, 120_000);
});
