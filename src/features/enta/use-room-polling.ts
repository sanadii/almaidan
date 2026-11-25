import { useEffect } from 'react';
import { isTerminalRoomRead } from './room-client';
import { subscribeRoomWake } from './room-wake';

export function useRoomPolling<T>({ enabled, read, receive, reject, retry, onHidden, interval = 1000 }: {
  enabled: boolean;
  read: (signal: AbortSignal) => Promise<T>;
  receive: (data: T) => boolean;
  reject: (error: unknown, terminal: boolean) => void;
  retry: number;
  onHidden?: () => void;
  interval?: number;
}) {
  useEffect(() => {
    if (!enabled) return;
    let request: AbortController | undefined, wake: ReturnType<typeof setTimeout> | undefined;
    let stopped = false, failures = 0;
    function cancel() {
      clearTimeout(wake);
      wake = undefined;
      request?.abort();
      request = undefined;
    }
    async function poll() {
      if (stopped || document.hidden || request) return;
      const controller = new AbortController();
      request = controller;
      const aborted = new Promise<never>((_resolve, rejectRead) => {
        controller.signal.addEventListener('abort', () => rejectRead(controller.signal.reason), { once: true });
      });
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const result = await Promise.race([read(controller.signal), aborted]);
        if (request !== controller || stopped) return;
        failures = 0;
        stopped = receive(result);
      } catch (error) {
        if (request !== controller || stopped) return;
        failures++;
        stopped = isTerminalRoomRead(error);
        reject(error, stopped);
      } finally {
        clearTimeout(timeout);
        if (request === controller) {
          request = undefined;
          if (!stopped && !document.hidden) wake = setTimeout(poll, Math.min(30000, interval * 2 ** failures));
        }
      }
    }
    function visibilityChanged() {
      if (stopped) return;
      cancel();
      if (document.hidden) onHidden?.();
      else void poll();
    }
    function reconnect() {
      if (request || stopped || document.hidden) return;
      clearTimeout(wake);
      void poll();
    }
    document.addEventListener('visibilitychange', visibilityChanged);
    const unsubscribe = subscribeRoomWake(reconnect);
    window.addEventListener('pageshow', reconnect);
    void poll();
    return () => {
      stopped = true;
      cancel();
      document.removeEventListener('visibilitychange', visibilityChanged);
      unsubscribe();
      window.removeEventListener('pageshow', reconnect);
    };
  }, [enabled, interval, onHidden, read, receive, reject, retry]);
}
