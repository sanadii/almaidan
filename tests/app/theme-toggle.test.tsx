import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../src/app/ThemeProvider';
import { ThemeToggle } from '../../src/design-system/ThemeToggle';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const bootstrap = readFileSync('public/theme-bootstrap.js', 'utf8');
const page = new DOMParser().parseFromString(readFileSync('index.html', 'utf8'), 'text/html');
const themeMetaSelector = 'meta[name="theme-color"][data-theme]';

function installThemeMetas() {
  for (const meta of page.querySelectorAll(themeMetaSelector)) {
    document.head.append(document.importNode(meta, true));
  }
}

function themeMedia() {
  return Array.from(document.querySelectorAll(themeMetaSelector), meta => meta.getAttribute('media'));
}

function mockSystemTheme(initiallyDark: boolean) {
  let matches = initiallyDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQuery = {
    addEventListener: (_: 'change', listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    media: '(prefers-color-scheme: dark)',
    removeEventListener: (_: 'change', listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    get matches() { return matches; },
  };
  vi.stubGlobal('matchMedia', vi.fn(() => mediaQuery));
  return (nextDark: boolean) => {
    matches = nextDark;
    for (const listener of listeners) listener({ matches } as MediaQueryListEvent);
  };
}

afterEach(() => {
  window.localStorage.clear();
  document.head.querySelectorAll(themeMetaSelector).forEach(meta => meta.remove());
  delete document.documentElement.dataset.theme;
  vi.unstubAllGlobals();
});

describe('ThemeToggle', () => {
  it('persists an explicit theme choice and applies it to the document', async () => {
    const user = userEvent.setup();
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>);
    await user.click(screen.getByLabelText('داكن'));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('huroof-theme')).toBe('dark');
  });

  it('resolves and announces the system preference through ThemeProvider', async () => {
    const setSystemTheme = mockSystemTheme(true);
    window.localStorage.setItem('huroof-theme', 'system');
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>);

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(screen.getByRole('radio', { name: 'حسب الجهاز — داكن الآن' })).toBeChecked();

    act(() => setSystemTheme(false));

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
    expect(screen.getByRole('radio', { name: 'حسب الجهاز — فاتح الآن' })).toBeChecked();
  });

  it('matches browser chrome to manual choices and restores device matching', async () => {
    mockSystemTheme(false);
    installThemeMetas();
    const user = userEvent.setup();
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>);

    await user.click(screen.getByLabelText('داكن'));
    expect(themeMedia()).toEqual(['not all', 'all']);

    await user.click(screen.getByLabelText('فاتح'));
    expect(themeMedia()).toEqual(['all', 'not all']);

    await user.click(screen.getByLabelText('حسب الجهاز — فاتح الآن'));
    expect(themeMedia()).toEqual(['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)']);
  });
});

describe('theme bootstrap', () => {
  it.each([
    { saved: null, darkDevice: false, expected: 'light' },
    { saved: null, darkDevice: true, expected: 'dark' },
    { saved: 'system', darkDevice: false, expected: 'light' },
    { saved: 'system', darkDevice: true, expected: 'dark' },
  ])('uses $expected for $saved on darkDevice=$darkDevice before React mounts', ({ saved, darkDevice, expected }) => {
    mockSystemTheme(darkDevice);
    installThemeMetas();
    if (saved) localStorage.setItem('huroof-theme', saved);
    runInNewContext(bootstrap, { window, document, localStorage });

    expect(document.documentElement.dataset.theme).toBe(expected);
    expect(themeMedia()).toEqual(['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)']);
  });

  it('enables only the saved manual chrome color before React mounts', () => {
    mockSystemTheme(false);
    installThemeMetas();
    localStorage.setItem('huroof-theme', 'dark');
    runInNewContext(bootstrap, { window, document, localStorage });

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(themeMedia()).toEqual(['not all', 'all']);
  });
});
