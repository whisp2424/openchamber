import { useEffect, useSyncExternalStore } from 'react';
import { isVSCodeRuntime } from '@/lib/desktop';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { subscribeRuntimeEndpointChanged, subscribeRuntimeEndpointWillChange } from '@/lib/runtime-switch';
import { createBackgroundController } from './controller';

export const chatBackground = createBackgroundController({
  request: runtimeFetch,
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
});
let consumers = 0;
let detach: (() => void) | null = null;

function useBackgroundLifecycle() {
  useEffect(() => {
    if (isVSCodeRuntime()) return;
    consumers += 1;
    if (consumers === 1) {
      const refresh = () => {
        if (document.visibilityState !== 'hidden') void chatBackground.refresh();
      };
      const beforeSwitch = subscribeRuntimeEndpointWillChange(() => chatBackground.reset());
      const afterSwitch = subscribeRuntimeEndpointChanged(refresh);
      window.addEventListener('focus', refresh);
      document.addEventListener('visibilitychange', refresh);
      detach = () => {
        beforeSwitch();
        afterSwitch();
        window.removeEventListener('focus', refresh);
        document.removeEventListener('visibilitychange', refresh);
        chatBackground.reset();
      };
      refresh();
    }
    return () => {
      consumers -= 1;
      if (consumers === 0) {
        detach?.();
        detach = null;
      }
    };
  }, []);
}

const getImageSnapshot = () => chatBackground.getSnapshot().imageUrl;
const getServerImageSnapshot = () => null;

export function useChatBackgroundImage() {
  const imageUrl = useSyncExternalStore(chatBackground.subscribe, getImageSnapshot, getServerImageSnapshot);
  useBackgroundLifecycle();
  return imageUrl;
}

export function useChatBackground() {
  const state = useSyncExternalStore(chatBackground.subscribe, chatBackground.getSnapshot);
  useBackgroundLifecycle();
  return state;
}
