import bytesFromHex from '@helpers/bytes/bytesFromHex';
import TcpObfuscated from '@lib/mtproto/transports/tcpObfuscated';
import {Obfuscator} from '@lib/mtproto/transports/obfuscation';
import ObfuscationProxy from '@lib/mtproto/transports/obfuscationProxy';
import paddedPacketCodec from '@lib/mtproto/transports/padded';
import {MTConnectionConstructable} from '@lib/mtproto/transports/transport';

/*
 * Transport wrapper for MTProto proxies (MTProxy / Fake-TLS) reached over
 * WebSocket. The MTProxy secret handshake replaces the plain obfuscated2
 * init: the AES keys are derived from the proxy secret and the dc id travels
 * inside the header instead of the relay `?dc=` query.
 *
 * Media connections (download/upload) use a negative dc id, matching how the
 * proxies route media traffic.
 *
 * Codec selection: fake-TLS / secure proxies (`ee`/`dd`-prefixed secrets) only
 * accept the MTProto secure protocol (tag 0xdddddddd, 4-byte length + random
 * padding framing) — the reference alexbers proxy ships with classic mode off
 * when a TLS domain is configured. Plain classic secrets keep abridged.
 */
export default class TcpObfuscatedProxy extends TcpObfuscated {
  private proxySecret: string;
  private proxyDcId: number;

  constructor(
    Connection: MTConnectionConstructable,
    dcId: number,
    url: string,
    secret: string,
    connectionType: 'client' | 'download' | 'upload',
    logSuffix: string,
    retryTimeout: number
  ) {
    super(Connection, dcId, url, logSuffix, retryTimeout);
    this.proxySecret = secret;
    this.proxyDcId = connectionType === 'client' ? dcId : -dcId;

    if(isSecureProxySecret(secret)) {
      this.codec = paddedPacketCodec;
    }
  }

  protected createObfuscation(): Obfuscator {
    return new ObfuscationProxy(normalizeProxySecret(this.proxySecret), this.proxyDcId);
  }
}

function decodeProxySecretBytes(secret: string): Uint8Array {
  if(/^[0-9a-fA-F]+$/.test(secret)) {
    return bytesFromHex(secret);
  }
  const bin = atob(secret);
  const bytes = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; ++i) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function isSecureProxySecret(secret: string): boolean {
  const bytes = decodeProxySecretBytes(secret);
  return bytes.length > 0 && (bytes[0] === 0xee || bytes[0] === 0xdd);
}

function normalizeProxySecret(secret: string): Uint8Array {
  let bytes = decodeProxySecretBytes(secret);
  // ee/dd/cc (and any other) fake-TLS prefixes are only meaningful at the TLS
  // layer, which the browser performs itself — strip them, keep the 16-byte
  // secret. Long secrets embed the fake-TLS SNI hostname after the secret
  // (e.g. ee + 16-byte secret + hex(hostname)); that trailing part is for the
  // TLS layer too and must be dropped.
  if(bytes.length >= 17 && (bytes[0] === 0xee || bytes[0] === 0xdd || bytes[0] === 0xcc)) {
    bytes = bytes.slice(1, 17);
  } else if(bytes.length === 17) {
    bytes = bytes.slice(1);
  }

  return bytes;
}
