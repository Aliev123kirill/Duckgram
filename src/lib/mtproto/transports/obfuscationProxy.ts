import randomize from '@helpers/array/randomize';
import bufferConcats from '@helpers/bytes/bufferConcats';
import cryptoMessagePort from '@lib/crypto/cryptoMessagePort';
import {Codec} from '@lib/mtproto/transports/codec';
import {Obfuscator} from '@lib/mtproto/transports/obfuscation';

/*
 * MTProto proxy (MTProxy / Fake-TLS) obfuscated handshake over WebSocket.
 *
 * Wire format verified against the reference server implementations
 * (mtprotoproxy `handle_handshake` and gramjs `TCPMTProxy`):
 *
 *   dec_key = sha256(header[8..40]   + secret)
 *   dec_iv  = header[40..56]
 *   enc_key = sha256(reverse(header[8..56])[0..32] + secret)
 *   enc_iv  = reverse(header[8..56])[32..48]
 *
 *   bytes 56..60 of the header carry the transport tag (0xefefefef abridged),
 *   bytes 60..62 carry the dc id (signed int16, little-endian); both are
 *   encrypted by the encryptor CTR stream before the header is sent.
 *
 * Unlike the plain obfuscated2 handshake, the AES keys are derived from the
 * proxy secret, so this class cannot reuse `Obfuscation` as-is.
 */
const SKIP_LEN = 8;
const PREKEY_LEN = 32;
const IV_LEN = 16;
const PROTO_TAG_POS = 56;
const DC_IDX_POS = 60;
const HANDSHAKE_LEN = 64;

export default class ObfuscationProxy implements Obfuscator {
  private id: number;
  private idPromise: Promise<ObfuscationProxy['id']>;
  private process: (data: Uint8Array, operation: 'encrypt' | 'decrypt') => ReturnType<ObfuscationProxy['_process']>;

  constructor(
    private secret: Uint8Array,
    private dcId: number
  ) {}

  public async init(codec: Codec) {
    if(this.idPromise !== undefined) {
      this.release();
    }

    const random = new Uint8Array(HANDSHAKE_LEN);
    randomize(random);

    while(true) {
      const val = (random[3] << 24) | (random[2] << 16) | (random[1] << 8) | random[0];
      const val2 = (random[7] << 24) | (random[6] << 16) | (random[5] << 8) | random[4];
      if(random[0] !== 0xef &&
          val !== 0x44414548 && // HEAD
          val !== 0x54534f50 && // POST
          val !== 0x20544547 && // "GET "
          val !== 0x4954504f && // OPTI
          val !== 0xeeeeeeee &&
          val !== 0xdddddddd &&
          val !== 0x16030102 && // TLS ClientHello
          val2 !== 0x00000000) {
        break;
      }
      randomize(random);
    }

    const randomReversed = random.slice(SKIP_LEN, SKIP_LEN + PREKEY_LEN + IV_LEN).reverse();

    const encKey = await cryptoMessagePort.invokeCrypto('sha256', bufferConcats(random.slice(SKIP_LEN, SKIP_LEN + PREKEY_LEN), this.secret));
    const encIv = random.slice(SKIP_LEN + PREKEY_LEN, SKIP_LEN + PREKEY_LEN + IV_LEN);
    const decKey = await cryptoMessagePort.invokeCrypto('sha256', bufferConcats(randomReversed.slice(0, PREKEY_LEN), this.secret));
    const decIv = randomReversed.slice(PREKEY_LEN, PREKEY_LEN + IV_LEN);

    const idPromise = this.idPromise = cryptoMessagePort.invokeCrypto('aes-ctr-prepare', {
      encKey,
      encIv,
      decKey,
      decIv
    });

    this.process = async(data, operation) => {
      await idPromise;
      return this._process(data, operation);
    };

    this.id = await idPromise;
    this.process = this._process;

    const initPayload = new Uint8Array(HANDSHAKE_LEN);
    initPayload.set(random.subarray(0, PROTO_TAG_POS), 0);
    initPayload.set(codec.obfuscateTag, PROTO_TAG_POS);
    initPayload[DC_IDX_POS] = this.dcId & 0xFF;
    initPayload[DC_IDX_POS + 1] = (this.dcId >> 8) & 0xFF;
    initPayload[62] = random[62];
    initPayload[63] = random[63];

    const encrypted = await this.encode(initPayload.slice());
    initPayload.set(encrypted.slice(PROTO_TAG_POS, HANDSHAKE_LEN), PROTO_TAG_POS);

    return initPayload;
  }

  private _process = (data: Uint8Array, operation: 'encrypt' | 'decrypt') => {
    return cryptoMessagePort.invokeCryptoNew({
      method: 'aes-ctr-process',
      args: [{id: this.id, data, operation}],
      transfer: [data.buffer]
    }) as Promise<Uint8Array>;
  };

  public encode(payload: Uint8Array) {
    return this.process(payload, 'encrypt');
  }

  public decode(payload: Uint8Array) {
    return this.process(payload, 'decrypt');
  }

  public async release() {
    const idPromise = this.idPromise;
    if(idPromise === undefined) {
      return;
    }

    this.id = undefined;
    this.idPromise = undefined;

    const id = await idPromise;
    cryptoMessagePort.invokeCrypto('aes-ctr-destroy', id);
  }

  public destroy() {
    this.release();
  }
}
