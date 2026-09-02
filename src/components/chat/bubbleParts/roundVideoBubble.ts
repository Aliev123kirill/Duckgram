import type {Message} from '@layer';

type WrapRoundVideoBubbleOptions = {
  bubble: HTMLElement;
  message: Message.message;
  globalMediaDeferred: Promise<HTMLMediaElement>;
  searchContext?: unknown;
};

export function wrapRoundVideoBubble(_options: WrapRoundVideoBubbleOptions) {
  // Round-video-to-audio transcription toggle removed.
}
