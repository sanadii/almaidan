import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../../src/app/App';

const hostedAdminLoaded = vi.hoisted(() => vi.fn());
vi.mock('../../src/lib/local-development', () => ({
  isAlmaidanLocalDevelopment: true,
  isAlmaidanRealContent: false,
  localContentNote: '',
}));
vi.mock('../../src/features/admin/AdminRoutes', () => {
  hostedAdminLoaded();
  return {};
});
vi.mock('../../src/features/local-admin/LocalAdminRoute', () => ({
  LocalAdminRoute: () => <h1>الإدارة المحلية</h1>,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

it.each([
  '/admin',
  '/admin/questions',
  '/admin/drafts/new',
  '/admin/rooms/example',
  '/admin/other/subpath',
  '/questions',
  '/questions/new',
  '/questions/example',
  '/questions/example/subpath',
])('redirects %s to local admin without loading the hosted module', async (path) => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  window.history.replaceState({}, '', path);
  render(<App />);

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'الإدارة المحلية' })).toBeVisible();
    expect(window.location.pathname).toBe('/local-admin');
  });
  expect(hostedAdminLoaded).not.toHaveBeenCalled();
});
