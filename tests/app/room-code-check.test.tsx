import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EntryRoute } from '../../src/routes/EntryRoute';
import { HomeSurface } from '../../src/routes/HomeSurface';
import { NameJoinRoute } from '../../src/routes/NameJoinRoute';
import { EntaRoomJoinRoute } from '../../src/features/enta/RoomRoutes';

vi.mock('../../src/features/game/runtime', () => ({ gameRuntime: { kind: 'local' } }));
vi.mock('../../src/lib/local-development', () => ({ isAlmaidanLocalDevelopment: true, isAlmaidanRealContent: false }));
vi.mock('../../src/design-system/InternalHeader', () => ({ InternalHeader: () => null }));
vi.mock('../../src/routes/HomeSurface', () => ({
  HomeSurface: ({ joinForm, joinMessage }: Parameters<typeof HomeSurface>[0]) => <main>{joinForm}{joinMessage}</main>,
}));

const fetcher = vi.fn<typeof fetch>();
const missing = 'ما لقينا غرفة بهذا الرمز. تأكدوا منه مع المضيف.';
const missingResponse = () => new Response(JSON.stringify({ error: 'ROOM_NOT_FOUND' }), { status: 404 });

beforeEach(() => {
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
  vi.stubEnv('VITE_STATIC_PREVIEW', 'false');
  sessionStorage.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function mount(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/" element={<EntryRoute staticPreview={false} />} />
    <Route path="/room/:roomCode/join" element={<NameJoinRoute />} />
    <Route path="/enta/rooms/:code/join" element={<EntaRoomJoinRoute />} />
  </Routes></MemoryRouter>);
}

it.each([
  ['BAD123', '/api/rooms/BAD123/exists'],
  ['E1-AB12CD34', '/api/v1/enta/rooms/E1-AB12CD34/join'],
  ['D1-AB12CD34', '/api/imposter/resolve/D1-AB12CD34'],
])('checks %s from home before asking for a player name', async (code, endpoint) => {
  fetcher.mockImplementation(async url => String(url) === endpoint ? missingResponse() : new Response(null, { status: 500 }));
  mount('/');
  const field = screen.getByRole('textbox', { name: 'رمز الغرفة' });
  expect(field).toHaveAttribute('placeholder', 'AB12CD');
  fireEvent.change(field, { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'الدخول' }));
  const error = await within(field.closest('label')!).findByRole('alert');
  expect(error).toHaveTextContent(missing);
  expect(field).toHaveFocus();
  expect(field).toHaveAccessibleName('رمز الغرفة');
  expect(field).toHaveAttribute('aria-describedby', error.id);
  expect(screen.queryByLabelText('اسم اللاعب')).toBeNull();
  expect(fetcher.mock.calls.filter(([url]) => String(url) === endpoint)).toHaveLength(1);
});

it.each(['/room/BAD123/join', '/room/D1-AB12CD34/join', '/enta/rooms/E1-AB12CD34/join'])(
  'checks a direct invite at %s and shows the same missing-room message', async path => {
    fetcher.mockImplementation(async () => missingResponse());
    mount(path);
    expect(await screen.findByRole('alert')).toHaveTextContent(missing);
    expect(screen.queryByLabelText('اسم اللاعب')).toBeNull();
    expect(screen.getByRole('link', { name: 'غيّر الرمز' })).toHaveAttribute('href', '/#room-code');
  },
);

it('opens a known Huroof name form after one read-only check', async () => {
  fetcher.mockImplementation(async () => new Response(null, { status: 204 }));
  mount('/');
  fireEvent.change(screen.getByLabelText('رمز الغرفة'), { target: { value: 'ab١۲cd' } });
  expect(screen.getByLabelText('رمز الغرفة')).toHaveValue('AB12CD');
  fireEvent.click(screen.getByRole('button', { name: 'الدخول' }));
  expect(await screen.findByLabelText('اسم اللاعب')).toBeEnabled();
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith('/exists'))).toHaveLength(1);
});

it.each([
  ['/room/OLD123/join', '/api/rooms/OLD123/exists', '/room/NEW123/join', '/api/rooms/NEW123/exists', 'NEW123'],
  ['/enta/rooms/E1-OLD23456/join', '/api/v1/enta/rooms/E1-OLD23456/join', '/enta/rooms/E1-NEW23456/join', '/api/v1/enta/rooms/E1-NEW23456/join', 'E1-NEW23456'],
])('offers the successor when a fresh tab opens %s', async (path, lookup, nextPath, nextLookup, successorCode) => {
  fetcher.mockImplementation(async url => {
    if (url === lookup) return Response.json({ finished: true, successorCode });
    if (url === nextLookup) return nextLookup.endsWith('/exists')
      ? new Response(null, { status: 204 })
      : Response.json({ teams: [{ id: 'sun', name: 'الشمس' }, { id: 'moon', name: 'القمر' }] });
    return missingResponse();
  });
  mount(path);
  const next = await screen.findByRole('link', { name: 'المضيف بدأ مباراة جديدة — ادخلوا' });
  expect(next).toHaveClass('button', 'button--primary');
  expect(next).toHaveAttribute('href', nextPath);
  expect(screen.queryByLabelText('اسم اللاعب')).toBeNull();
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([lookup]);
  fireEvent.click(next);
  expect(await screen.findByLabelText('اسم اللاعب')).toBeEnabled();
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([lookup, nextLookup]);
  expect(fetcher.mock.calls.every(([, init]) => init?.method === 'GET' || init?.method === undefined)).toBe(true);
});

it.each(['/room/OLD123/join', '/enta/rooms/E1-OLD23456/join'])('shows home when %s ends without a successor', async path => {
  fetcher.mockResolvedValue(Response.json({ finished: true }));
  mount(path);
  expect(await screen.findByRole('heading', { name: 'انتهت هذه المباراة' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'الرئيسية' })).toHaveAttribute('href', '/');
  expect(screen.queryByLabelText('اسم اللاعب')).toBeNull();
  expect(screen.queryByRole('button', { name: 'إعادة المحاولة' })).toBeNull();
});

it('ignores the reply for a code edited during the check', async () => {
  let complete!: (response: Response) => void;
  fetcher.mockImplementation(async () => new Promise(resolve => { complete = resolve; }));
  mount('/');
  const field = screen.getByLabelText('رمز الغرفة');
  fireEvent.change(field, { target: { value: 'ABC123' } });
  fireEvent.click(screen.getByRole('button', { name: 'الدخول' }));
  fireEvent.change(field, { target: { value: 'DEF456' } });
  await act(async () => complete(missingResponse()));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: 'الدخول' })).toBeEnabled();
});
