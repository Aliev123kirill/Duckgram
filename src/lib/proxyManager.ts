import {StateSettings} from '@config/state';
import {useAppSettings} from '@stores/appSettings';
import rootScope from '@lib/rootScope';
import {setProxyUrl, getProxyUrl} from '@lib/proxyUrl';

type ProxyServerEntry = StateSettings['proxy']['servers'][number];

class ProxyManager {
  private appliedServer: ProxyServerEntry | null = null;

  init() {
    this.applyCurrent();

    rootScope.addEventListener('settings_updated', this.applyCurrent);
  }

  private applyCurrent = () => {
    const [appSettings] = useAppSettings();
    const proxy = appSettings.proxy;
    const server = proxy?.enabled && proxy.currentServer >= 0 ? proxy.servers[proxy.currentServer] : undefined;

    if(!server) {
      if(this.appliedServer) {
        this.removeProxy();
      }
      return;
    }

    if(this.appliedServer &&
       this.appliedServer.host === server.host &&
       this.appliedServer.port === server.port &&
       this.appliedServer.secret === server.secret) {
      return;
    }

    this.appliedServer = server;
    setProxyUrl('ws://' + server.host + ':' + server.port + '/', server.secret);
    rootScope.dispatchEvent('proxy_url_change', getProxyUrl());
  };

  removeProxy() {
    this.appliedServer = null;
    setProxyUrl(null);
    rootScope.dispatchEvent('proxy_url_change', null);
  }

  isEnabled(): boolean {
    return getProxyUrl() !== null;
  }
}

const proxyManager = new ProxyManager();
export default proxyManager;
