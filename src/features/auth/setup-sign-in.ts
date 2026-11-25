import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

type SetupState = { setupDraft: { path: string; fields: Record<string, unknown> } };

/** Navigation state carries editable choices on the same tab without putting names in the URL. */
export function useSetupSignIn(verified: boolean) {
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname + location.search + location.hash;
  const draft = (location.state as SetupState | null)?.setupDraft;
  const fields = verified && draft?.path === path ? draft.fields : undefined;

  useEffect(() => {
    if (fields) navigate(path, { replace: true, state: null });
  }, [fields, navigate, path]);

  return {
    fields,
    signIn: (setupFields: Record<string, unknown>) => navigate(`/login?returnTo=${encodeURIComponent(path)}`, {
      state: { setupDraft: { path, fields: setupFields } } satisfies SetupState,
    }),
  };
}

export function setupGameForReturn(returnTo: string | null): string | null {
  if (!returnTo) return null;
  const [path, query] = returnTo.split('#', 1)[0].split('?');
  if (/^\/enta\/(?:competitive\/)?new(?:\/|$)/.test(path)) return 'إنت صح';
  if (path === '/host/new') return new URLSearchParams(query).get('kind') === 'imposter' ? 'الدخيل' : 'الخلية';
  return null;
}
