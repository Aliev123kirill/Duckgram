import {createSignal, For, Show} from 'solid-js';
import Section from '@components/section';
import Row from '@components/rowTsx';
import Button from '@components/buttonTsx';
import CheckboxFieldTsx from '@components/checkboxFieldTsx';
import {IconTsx} from '@components/iconTsx';
import {InputFieldTsx} from '@components/inputFieldTsx';
import {i18n} from '@lib/langPack';
import {useAppSettings} from '@stores/appSettings';
import {StateSettings} from '@config/state';
import styles from './index.module.scss';

type ProxyServerEntry = StateSettings['proxy']['servers'][number];

function parseProxyLink(raw: string): ProxyServerEntry | null {
  const match = raw.trim().match(/^(?:https?:\/\/)?(?:tg:\/\/proxy\?|t\.me\/proxy\?)(.+)/i);
  if(!match) {
    return null;
  }

  const params = new URLSearchParams(match[1]);
  const host = params.get('server');
  const port = parseInt(params.get('port') || '443', 10);
  if(!host || !port) {
    return null;
  }

  return {
    host,
    port,
    name: params.get('name') || host,
    secret: params.get('secret') || undefined
  };
}

const Proxy = () => {
  const [appSettings, setAppSettings] = useAppSettings();
  const proxy = () => appSettings.proxy;

  const [host, setHost] = createSignal('');
  const [port, setPort] = createSignal('');
  const [secret, setSecret] = createSignal('');
  const [importUrl, setImportUrl] = createSignal('');

  const addServer = () => {
    const h = host().trim();
    const p = parseInt(port(), 10);
    if(!h || !p) {
      return;
    }

    setAppSettings('proxy', 'servers', [
      ...proxy().servers,
      {
        host: h,
        port: p,
        name: h,
        secret: secret().trim() || undefined
      }
    ]);
    setAppSettings('proxy', 'currentServer', proxy().servers.length);
    setAppSettings('proxy', 'enabled', true);

    setHost('');
    setPort('');
    setSecret('');
  };

  const importProxy = () => {
    const server = parseProxyLink(importUrl());
    if(!server) {
      return;
    }

    setAppSettings('proxy', 'servers', [...proxy().servers, server]);
    setAppSettings('proxy', 'currentServer', proxy().servers.length);
    setAppSettings('proxy', 'enabled', true);
    setImportUrl('');
  };

  const removeServer = (index: number) => {
    const servers = proxy().servers.filter((_, i) => i !== index);
    setAppSettings('proxy', 'servers', servers);

    if(index === proxy().currentServer) {
      if(!servers.length) {
        setAppSettings('proxy', 'currentServer', -1);
        setAppSettings('proxy', 'enabled', false);
      } else {
        setAppSettings('proxy', 'currentServer', Math.min(index, servers.length - 1));
      }
    } else if(index < proxy().currentServer) {
      setAppSettings('proxy', 'currentServer', proxy().currentServer - 1);
    }
  };

  const onEnableChange = (value: boolean) => {
    setAppSettings('proxy', 'enabled', value);
    if(value && proxy().currentServer < 0 && proxy().servers.length > 0) {
      setAppSettings('proxy', 'currentServer', 0);
    }
  };

  return (
    <>
      <Section name="Proxy">
        <Row classList={{[styles.enabledRow]: true}}>
          <Row.Icon icon="link" class={styles.enabledIcon} />
          <Row.Title>{i18n('Proxy.Enabled')}</Row.Title>
          <Row.CheckboxField>
            <CheckboxFieldTsx
              checked={proxy().enabled}
              onChange={onEnableChange}
            />
          </Row.CheckboxField>
        </Row>
      </Section>

      <Show when={proxy().enabled}>
        <Section name="Proxy.Add">
          <div class={styles.addWrap}>
            <div class={styles.fieldRow}>
              <label class={styles.importLabel}>{i18n('Proxy.ImportLink')}</label>
              <textarea
                class={styles.importArea}
                value={importUrl()}
                placeholder={'tg://proxy?server=...&port=443&secret=...'}
                onInput={(e) => setImportUrl(e.currentTarget.value)}
                rows={3}
              />
              <Button class="btn-primary btn-color-primary" text="Proxy.Import" onClick={importProxy} />
            </div>
            <div class={styles.divider} />
            <div class={styles.fieldGrid}>
              <InputFieldTsx label="Proxy.Server" value={host()} onRawInput={setHost} />
              <InputFieldTsx label="Proxy.Port" value={port()} onRawInput={setPort} />
              <InputFieldTsx class={styles.secretField} label="Proxy.Secret" value={secret()} onRawInput={setSecret} />
            </div>
            <Button class="btn-primary btn-color-primary" text="Proxy.Add.Button" onClick={addServer} />
          </div>
        </Section>

        <Show when={proxy().servers.length > 0}>
          <Section name="Proxy.Servers">
            <div class={styles.serverList}>
              <For each={proxy().servers}>
                {(server, index) => {
                  const isActive = () => index() === proxy().currentServer;
                  return (
                    <Row
                      class={styles.serverCard}
                      classList={{[styles.serverActive]: isActive()}}
                      clickable={() => {
                        if(!isActive()) {
                          setAppSettings('proxy', 'currentServer', index());
                        }
                      }}
                    >
                      <Row.Icon icon="link" class={styles.serverIcon} />
                      <Row.Title>{server.name || (server.host + ':' + server.port)}</Row.Title>
                      <Row.Subtitle>{server.host + ':' + server.port}{server.secret ? '  •  MTProto' : ''}</Row.Subtitle>
                      <Row.RightContent>
                        <Show when={isActive()}>
                          <div class={styles.activePill}>
                            <IconTsx icon="check" />
                          </div>
                        </Show>
                        <Button.Icon
                          icon="delete"
                          noRipple
                          onClick={(e) => {
                            e.stopPropagation();
                            removeServer(index());
                          }}
                        />
                      </Row.RightContent>
                    </Row>
                  );
                }}
              </For>
            </div>
          </Section>
        </Show>
      </Show>
    </>
  );
};

export default Proxy;
