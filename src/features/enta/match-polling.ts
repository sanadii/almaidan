/** Keep one read in flight and refresh as soon as a hidden match becomes visible. */
export function pollVisibleMatch(read: (controller: AbortController) => Promise<void>, delay: number) {
  let generation = 0;
  let request: AbortController | null = null;
  let timer: number | undefined;
  let timeout: number | undefined;
  function pause() {
    generation++;
    window.clearTimeout(timer);
    window.clearTimeout(timeout);
    request?.abort();
  }
  async function poll() {
    if (document.hidden) return;
    const started = generation;
    const controller = new AbortController();
    request = controller;
    const aborted = new Promise<void>(resolve => controller.signal.addEventListener('abort', () => resolve(), { once: true }));
    const deadline = window.setTimeout(() => controller.abort(), 8000);
    timeout = deadline;
    try { await Promise.race([read(controller), aborted]); } finally { window.clearTimeout(deadline); }
    if (generation === started && !document.hidden) timer = window.setTimeout(poll, delay);
  }
  function visibilityChanged() { pause(); if (!document.hidden) void poll(); }
  document.addEventListener('visibilitychange', visibilityChanged);
  void poll();
  return () => { pause(); document.removeEventListener('visibilitychange', visibilityChanged); };
}
