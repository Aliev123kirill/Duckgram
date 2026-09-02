import {Chat, User} from '@layer';
import getPeerActiveUsernames from '@appManagers/utils/peers/getPeerActiveUsernames';

// Эксклюзив Duckgram.
//
// У владельцев этого клиента рядом с именем показывается стикер sticker1.webp —
// как «альтернатива галочки» (verified-бейджа). Список задаётся username'ами
// аккаунтов (без '@', сравнение без учёта регистра).
export const DUCKGRAM_EXCLUSIVE_USERNAMES = new Set(['sIpoAVeEABx', 'VOVKAIT']);
export const DUCKGRAM_EXCLUSIVE_STICKER_URL = 'assets/img/sticker1.webp';

export function isDuckgramExclusivePeer(peer: User | Chat | undefined): boolean {
  if(!peer) return false;

  const username = getPeerActiveUsernames(peer)[0];
  return !!username && DUCKGRAM_EXCLUSIVE_USERNAMES.has(username.toLowerCase());
}
