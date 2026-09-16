import PopupElement, {addCancelButton} from '.';
import PopupPeer, {PopupPeerButtonCallback, PopupPeerOptions} from '@components/popups/peer';
import {FormatterArguments, LangPackKey} from '@lib/langPack';

export default class PopupPinMessage {
  constructor(private peerId: PeerId, private mid: number, private unpin?: true, private onConfirm?: () => void) {
    this.construct();
  }

  private async construct() {
    const {peerId, mid, unpin, onConfirm} = this;
    let title: LangPackKey, description: LangPackKey, descriptionArgs: FormatterArguments;
    const buttons: PopupPeerOptions['buttons'] = [];

    const managers = PopupElement.MANAGERS;

    const callback: PopupPeerButtonCallback = () => {
      setTimeout(() => { // * костыль, потому что document.elementFromPoint вернёт popup-peer пока он будет закрываться
        let promise: Promise<any>;
        if(unpin && !mid) {
          promise = managers.appMessagesManager.unpinAllMessages(peerId);
        } else {
          promise = managers.appMessagesManager.updatePinnedMessage(peerId, mid, unpin);
        }

        if(onConfirm) {
          promise.then(onConfirm);
        }
      }, 300);
    };

    if(unpin) {
      const buttonText: LangPackKey = 'UnpinMessage';
      if(!mid) {
        title = 'Popup.Unpin.AllTitle';
        description = 'Chat.UnpinAllMessagesConfirmation';
        descriptionArgs = ['' + ((await managers.appMessagesManager.getPinnedMessagesCount(peerId)) || 1)];
      } else {
        title = 'UnpinMessageAlertTitle';
        description = 'Chat.Confirm.Unpin';
      }

      buttons.push({
        langKey: buttonText,
        isDanger: true,
        callback
      });
    } else {
      title = 'PinMessageAlertTitle';
      description = 'PinMessageAlert';

      buttons.push({
        langKey: 'PinMessage',
        callback
      });
    }

    addCancelButton(buttons);

    const popup = PopupElement.createPopup(PopupPeer, 'popup-delete-chat', {
      peerId,
      titleLangKey: title,
      descriptionLangKey: description,
      descriptionLangArgs: descriptionArgs,
      buttons
    });

    popup.show();
  }
}
