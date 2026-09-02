import I18n from '@lib/langPack';
import {FOLDER_ID_PINNED} from '@appManagers/constants';
import type {MyDialogFilter} from '@lib/storages/filters';

export default function getPinnedFilter(): MyDialogFilter {
  return {
    _: 'dialogFilter',
    id: FOLDER_ID_PINNED,
    localId: FOLDER_ID_PINNED as any,
    title: {
      _: 'textWithEntities',
      text: I18n.format('PinnedChats', true),
      entities: []
    },
    pFlags: {},
    pinned_peers: [],
    include_peers: [],
    exclude_peers: []
  };
}
