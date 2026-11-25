import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

const StatusToastContext = createContext<((message: string) => void) | null>(null);

export function StatusToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string } | null>(null);
  const expiry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const announce = useCallback((message: string) => {
    clearTimeout(expiry.current);
    setToast({ message });
    expiry.current = setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => () => clearTimeout(expiry.current), []);

  return <StatusToastContext.Provider value={announce}>
    {children}
    <div className="app-toast" role="status" aria-atomic="true">
      {toast ? <span>{toast.message}</span> : null}
    </div>
  </StatusToastContext.Provider>;
}

export function useCopyStatus() {
  const announce = useContext(StatusToastContext);
  const [localStatus, setLocalStatus] = useState('');

  async function copyText(text: string | Promise<string | null>, success: string, failure: string) {
    let message = success;
    try {
      if (typeof text !== 'string' && typeof ClipboardItem === 'function' && navigator.clipboard?.write) {
        // Start the clipboard write in the click handler while the browser still has user activation.
        const content = text.then(value => {
          if (!value) throw new Error('Copy content unavailable');
          return new Blob([value], { type: 'text/plain' });
        });
        void content.catch(() => {});
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': content })]);
      } else {
        const value = typeof text === 'string' ? text : await text;
        if (!value) return;
        await navigator.clipboard.writeText(value);
      }
    } catch {
      message = failure;
    }
    (announce ?? setLocalStatus)(message);
  }

  return { copyText, localStatus };
}
