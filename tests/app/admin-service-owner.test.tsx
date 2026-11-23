import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ user: { uid: 'a' }, call: vi.fn() }));
vi.mock('../../src/lib/firebase/client', () => ({ getOptionalFirebaseAdminClient: () => ({ auth: { get currentUser() { return mocks.user; } }, functions: {} }) }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => mocks.call }));
import { adminCall } from '../../src/features/admin/admin-service';
import { beginOwnerProvider, observeProviderOwner, invalidateOwner } from '../../src/features/enta/auth-epoch';
beforeEach(() => { mocks.user = { uid: 'a' }; mocks.call.mockReset(); invalidateOwner(); });
it('rejects late response after A to B to A and blocks dispatch without matching owner', async () => {
  const lease = beginOwnerProvider(); observeProviderOwner(lease, 'a'); let resolve!: (v: unknown) => void;
  mocks.call.mockReturnValue(new Promise(r => { resolve = r; })); const result = adminCall('read', {});
  mocks.user = { uid: 'b' }; observeProviderOwner(lease, 'b'); mocks.user = { uid: 'a' }; observeProviderOwner(lease, 'a'); resolve({ data: 'private' });
  await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  mocks.user = { uid: 'b' }; await expect(adminCall('write', {})).rejects.toMatchObject({ name: 'AbortError' }); expect(mocks.call).toHaveBeenCalledTimes(1);
});
