import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { ContactRoute } from '../../src/routes/ContactRoute';
import { ThemeProvider } from '../../src/app/ThemeProvider';

it('shows the owner-supplied identity and opens the support email', () => {
  render(<ThemeProvider><MemoryRouter><ContactRoute /></MemoryRouter></ThemeProvider>);
  expect(screen.getByRole('heading', { name: 'تواصل معنا' })).toBeVisible();
  expect(screen.getByText(/AlMaidan/)).toBeVisible();
  expect(screen.getByRole('link', { name: 'almaidan@q8vision.com' })).toHaveAttribute('href', 'mailto:almaidan@q8vision.com');
});

it('exposes the contact page in public routing and the home footer', async () => {
  const [app, homeSource,footer] = await Promise.all(['src/app/App.tsx', 'src/routes/HomeSurface.tsx','src/design-system/PublicFooter.tsx'].map(path => readFile(resolve(path), 'utf8')));
  expect(app).toMatch(/path="\/contact"/);
  expect(homeSource).toMatch(/<PublicFooter home/);
  expect(footer).toMatch(/to="\/contact"/);
});
