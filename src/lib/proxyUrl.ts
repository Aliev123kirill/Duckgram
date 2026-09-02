export type ProxyConnectionType = 'client' | 'download' | 'upload';

let _proxyUrl: string | null = null;
let _proxySecret: string | null = null;

export function setProxyUrl(url: string | null, secret?: string | null) {
  _proxyUrl = url;
  _proxySecret = secret || null;
}

export function getProxyUrl(): string | null {
  return _proxyUrl;
}

export function getProxySecret(): string | null {
  return _proxySecret;
}

export function getProxyUrlForDc(_dcId: number, _connectionType?: ProxyConnectionType, _premium?: boolean): string | null {
  return _proxyUrl;
}
