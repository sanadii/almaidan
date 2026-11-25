import { readFileSync } from 'node:fs';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import { HistoryView } from '../../src/features/enta/HistoryRoutes';

it('starts the mobile filter disclosure closed, counts active filters and retains selections when closed', () => {
  render(<MemoryRouter><HistoryView /></MemoryRouter>);
  const toggle = screen.getByRole('button', { name: 'تصفية' });
  const game = screen.getByLabelText('اللعبة');
  const mode = screen.getByLabelText('نوع المباراة');
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(game.closest('#history-filters')).toHaveAttribute('data-open', 'false');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  fireEvent.change(game, { target: { value: 'enta' } });
  fireEvent.change(mode, { target: { value: 'KIDS' } });
  expect(toggle).toHaveAccessibleName('تصفية (2)');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(toggle).toHaveAccessibleName('تصفية (2)');
  fireEvent.click(toggle);
  expect(mode).toHaveValue('KIDS');
  fireEvent.change(game, { target: { value: 'huroof' } });
  expect(toggle).toHaveAccessibleName('تصفية (1)');
  expect(screen.queryByLabelText('نوع المباراة')).toBeNull();
});

it('hides the disclosure at 768px and wider while leaving inline controls visible', () => {
  const css = readFileSync('src/styles/enta.css', 'utf8');
  expect(css).toMatch(/\.enta-history-filters\s*\{\s*display:\s*flex/);
  expect(css).toMatch(/\.enta-history-filter-toggle\s*\{\s*display:\s*none/);
  expect(css).toMatch(/@media \(width < 768px\)\s*\{[^]*?\.enta-history-filters--responsive\[data-open="false"\]\s*\{\s*display:\s*none/);
});
