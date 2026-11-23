import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, it, expect, vi } from 'vitest';
const auth = vi.hoisted(() => ({ user: { uid: 'a', getIdToken: async () => 'token' }, status: 'authenticated' }));
const post = vi.hoisted(() => vi.fn());
vi.mock('../../src/features/auth/auth-context', () => ({ useFirebaseAuth: () => auth }));
vi.mock('../../src/features/study/client', () => ({ studyPost: post }));
import { ThemeProvider } from '../../src/app/ThemeProvider';
import { StudyRoute } from '../../src/features/study/StudyRoute';
import { beginOwnerProvider, observeProviderOwner, invalidateOwner } from '../../src/features/enta/auth-epoch';
const wrap = (available = false) => <ThemeProvider><MemoryRouter><StudyRoute available={available} /></MemoryRouter></ThemeProvider>;
let lease: ReturnType<typeof beginOwnerProvider>;
beforeEach(() => { auth.user = { uid: 'a', getIdToken: async () => 'token' }; lease = beginOwnerProvider(); observeProviderOwner(lease, 'a'); post.mockReset(); });
afterEach(() => { cleanup(); invalidateOwner(); });
it('truthfully shows study unavailable until a qualified service is enabled', () => {
  render(wrap()); expect(screen.getByText('التدريب غير متاح حالياً.')).toHaveAttribute('role', 'status'); expect(screen.queryByRole('button', { name: 'ابدأ التدريب' })).not.toBeInTheDocument();
});
it('fences displayed and pending data across A to B to A', async () => {
  post.mockResolvedValue({ sessionId: 's', progress: { answered: 0, total: 1 }, question: { id: 'q', prompt: 'private question', choices: [{ id: '1', text: 'one' }, { id: '2', text: 'two' }] } });
  const rendered = render(wrap(true)); fireEvent.click(screen.getByRole('button', { name: 'ابدأ التدريب' })); await screen.findByText('private question');
  auth.user = { uid: 'b', getIdToken: async () => 'token' }; await act(async () => observeProviderOwner(lease, 'b')); rendered.rerender(wrap(true)); expect(screen.queryByText('private question')).not.toBeInTheDocument();
  auth.user = { uid: 'a', getIdToken: async () => 'token' }; await act(async () => observeProviderOwner(lease, 'a')); rendered.rerender(wrap(true)); expect(screen.queryByText('private question')).not.toBeInTheDocument();
});
it('retries an uncertain start with the same request id', async () => {
  post.mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce({ sessionId: 's', progress: { answered: 0, total: 1 }, question: { id: 'q', prompt: 'prompt', choices: [{ id: '1', text: 'one' }, { id: '2', text: 'two' }] } });
  render(wrap(true)); fireEvent.click(screen.getByRole('button', { name: 'ابدأ التدريب' })); fireEvent.click(await screen.findByRole('button', { name: 'إعادة المحاولة' })); await screen.findByText('prompt'); expect(post.mock.calls[1][2]).toEqual(post.mock.calls[0][2]);
});

it('rejects malformed public responses instead of displaying a false success', async () => {
  post.mockResolvedValue({ sessionId: 's', progress: { answered: 1, total: 1 }, question: null, correct: 'false' });
  render(wrap(true)); fireEvent.click(screen.getByRole('button', { name: 'ابدأ التدريب' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('تعذر تأكيد'); expect(screen.queryByText('إجابة صحيحة')).not.toBeInTheDocument();
});
