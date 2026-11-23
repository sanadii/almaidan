import { createContext } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';

vi.mock('../../src/features/game/runtime', () => ({
  gameRuntime: { kind: 'fixture' },
  PgRuntimeContext: createContext(null),
}));
vi.mock('../../src/features/game/runtime/room-context', () => ({
  PgRuntimeContext: createContext(null),
}));
vi.mock('../../src/design-system/InternalHeader', () => ({
  InternalHeader: () => null,
}));
vi.mock('../../src/features/game/runtime/static-preview', () => ({
  isStaticPreviewBuild: () => false,
  staticPreviewNotice: '',
}));

it('real PG room route renders host, player and display initial states without transport', async () => {
  const { RoomRoute } = await import('../../src/routes/GameRoutes');
  for (const surface of ['host', 'play', 'display'] as const) {
    const html = renderToString(
      <MemoryRouter initialEntries={['/room/M2-ABCDEFGH']}>
        <Routes>
          <Route path="/room/:roomCode" element={<RoomRoute surface={surface} />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(html).toMatch(/جارٍ الاتصال بالغرفة/);
    expect(html).not.toMatch(/privateGrading|acceptedAnswers|canonicalAnswer|إظهار الحل/);
  }
});
