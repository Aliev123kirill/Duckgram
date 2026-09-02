import type {AppManagers} from '@lib/managers';
import type {AppChatFoldersTab} from '@components/solidJsTabs/tabs';
import type {AppEditFolderTab} from '@components/solidJsTabs/tabs';
import type {AppSidebarLeft} from '@components/sidebarLeft';
import {FOLDER_ID_ALL, FOLDER_ID_PINNED, REAL_FOLDERS} from '@appManagers/constants';
import createContextMenu from '@helpers/dom/createContextMenu';
import findUpClassName from '@helpers/dom/findUpClassName';

export default function createFolderContextMenu({
  appSidebarLeft,
  AppChatFoldersTab: _AppChatFoldersTab,
  AppEditFolderTab: _AppEditFolderTab,
  managers,
  className,
  listenTo
}: {
  appSidebarLeft: AppSidebarLeft,
  AppChatFoldersTab: typeof AppChatFoldersTab,
  AppEditFolderTab: typeof AppEditFolderTab,
  managers: AppManagers,
  className: string,
  listenTo: HTMLElement
}) {
  async function openSettingsForFilter(filterId: number) {
    if(REAL_FOLDERS.has(filterId)) return;

    if(filterId === FOLDER_ID_PINNED) {
      appSidebarLeft.closeTabsBefore(() => {
        appSidebarLeft.createTab(_AppChatFoldersTab).open(_AppChatFoldersTab.getInitArgs());
      });
      return;
    }

    const filter = await managers.filtersStorage.getFilter(filterId);

    appSidebarLeft.closeTabsBefore(() => {
      appSidebarLeft.createTab(_AppEditFolderTab).open({..._AppEditFolderTab.getInitArgs(), initFilter: filter});
    });
  }

  let clickFilterId: number;
  const {destroy} = createContextMenu({
    buttons: [{
      icon: 'edit',
      text: 'FilterEdit',
      onClick: () => {
        openSettingsForFilter(clickFilterId);
      },
      verify: () => clickFilterId !== FOLDER_ID_ALL && clickFilterId !== FOLDER_ID_PINNED
    }, {
      icon: 'edit',
      text: 'FilterEditAll',
      onClick: () => {
        appSidebarLeft.closeTabsBefore(() => {
          appSidebarLeft.createTab(_AppChatFoldersTab).open(_AppChatFoldersTab.getInitArgs());
        });
      },
      verify: () => clickFilterId === FOLDER_ID_ALL || clickFilterId === FOLDER_ID_PINNED
    }, {
      icon: 'readchats',
      text: 'MarkAllAsRead',
      onClick: () => {
        managers.dialogsStorage.markFolderAsRead(clickFilterId);
      },
      verify: async() => !!(await managers.dialogsStorage.getFolderUnreadCount(clickFilterId)).unreadCount
    }, {
      icon: 'delete',
      className: 'danger',
      text: 'Delete',
      onClick: () => {
        _AppEditFolderTab.deleteFolder(clickFilterId);
      },
      verify: () => clickFilterId !== FOLDER_ID_ALL && clickFilterId !== FOLDER_ID_PINNED
    }],
    listenTo,
    findElement: (e) => findUpClassName(e.target, className),
    onOpen: (e, target) => {
      clickFilterId = +target.dataset.filterId;
    }
  });

  return {destroy, openSettingsForFilter};
}
