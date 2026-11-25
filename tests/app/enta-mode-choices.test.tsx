import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it } from 'vitest';
import { EntaModeChoices } from '../../src/features/enta/EntaModeChoices';

afterEach(cleanup);

function mountPicker() {
  render(<MemoryRouter initialEntries={['/enta/new']}><EntaModeChoices /></MemoryRouter>);
  return screen.getByRole('navigation', { name: 'نوع اللعب' });
}

it('offers four distinct picture choices and keeps mixed boards and history accessible', () => {
  const choices = mountPicker();
  const links = within(choices).getAllByRole('link');
  expect(links.map(link => link.getAttribute('href'))).toEqual([
    '#enta-classic-setup', '/enta/new/list', '/enta/new/acting', '/enta/new/drawing',
  ]);
  const pictures = Array.from(choices.querySelectorAll('picture'));
  expect(pictures).toHaveLength(4);
  const sources = pictures.map(picture => picture.querySelector('source[type="image/avif"]')?.getAttribute('srcset'));
  expect(sources).toEqual(['questions', 'lists', 'acting', 'drawing'].map(mode => `/assets/games/enta-mode-${mode}-v1-320.avif`));
  pictures.forEach((picture, index) => {
    expect(sources[index]).toMatch(/\.avif$/);
    expect(picture.querySelector('img')).toHaveAttribute('src', sources[index]?.replace(/\.avif$/, '.webp'));
    expect(picture.querySelector('img')).toHaveAttribute('width', '320');
    expect(picture.querySelector('img')).toHaveAttribute('height', '214');
  });
  expect(screen.getByRole('link', { name: 'لوحة متنوعة' })).toHaveAttribute('href', '/enta/new/mixed');
  expect(screen.getByRole('link', { name: 'مبارياتي' })).toHaveAttribute('href', '/enta/history');
  for (const name of ['لوحة متنوعة', 'مبارياتي']) {
    expect(screen.getByRole('link', { name })).toHaveClass('enta-mode-picker__link');
  }
  expect(readFileSync('src/features/enta/enta-mode-choices.css', 'utf8')).toMatch(/\.enta-mode-picker__link\s*\{[^}]*min-block-size:\s*44px/);
  expect(within(choices).queryByText('مبارياتي')).toBeNull();
});

it('routes the aid and kids switches to supported setups and restores the ordinary drawing route', () => {
  const choices = mountPicker();
  const aids = screen.getByRole('switch', { name: 'مع المساعدات' });
  const kids = screen.getByRole('switch', { name: 'للأطفال' });
  fireEvent.click(aids);
  const link = (name: string) => within(choices).getByRole('link', { name });
  expect(link('أسئلة')).toHaveAttribute('href', '/enta/competitive/new/classic');
  expect(link('قوائم')).toHaveAttribute('href', '/enta/competitive/new/list');
  expect(link('تمثيل')).toHaveAttribute('href', '/enta/competitive/new/acting');
  expect(link('رسم')).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByRole('link', { name: 'لوحة متنوعة' })).toHaveAttribute('href', '/enta/competitive/new/mixed');
  fireEvent.click(kids);
  expect(aids).not.toBeChecked();
  expect(link('أسئلة')).toHaveAttribute('href', '/enta/new/kids');
  for (const name of ['قوائم', 'تمثيل', 'رسم']) expect(link(name)).not.toHaveAttribute('href');
  fireEvent.click(kids);
  expect(link('رسم')).toHaveAttribute('href', '/enta/new/drawing');
});
