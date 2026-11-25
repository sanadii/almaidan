type StoredCapability = { token: string; role: 'host' | 'player' | 'audience' };

const capabilityKey = (id: string) => `huroof:${id}`;
const audienceKey = (id: string) => `huroof:${id}:audience`;
const codeKey = (code: string) => `huroof:code:${code}`;
export const huroofSessionsCleared = 'huroof-sessions-cleared';

function readCapability(key: string): StoredCapability | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (typeof value?.token === 'string' && ['host', 'player', 'audience'].includes(value.role)) return value;
  } catch { /* The room can be opened through its join link. */ }
  return undefined;
}

export const capabilityFor = (id: string) => readCapability(capabilityKey(id));
export const audienceCapabilityFor = (id: string) => readCapability(audienceKey(id));
export const saveCapability = (id: string, value: StoredCapability) =>
  sessionStorage.setItem(capabilityKey(id), JSON.stringify(value));
export const saveAudienceCapability = (id: string, value: StoredCapability) =>
  sessionStorage.setItem(audienceKey(id), JSON.stringify(value));
export const saveRoomCode = (code: string, id: string) => sessionStorage.setItem(codeKey(code), id);

export function savedRoomId(code: string) {
  try { return sessionStorage.getItem(codeKey(code)) ?? undefined; }
  catch { return undefined; }
}

export function forgetRoomCapability(id: string, audience: boolean) {
  try { sessionStorage.removeItem(audience ? audienceKey(id) : capabilityKey(id)); }
  catch { /* The room still terminates if browser storage is blocked. */ }
}

export function clearHuroofSessions() {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith('huroof:')) sessionStorage.removeItem(key);
    }
  } catch { /* A storage-blocked browser still closes its live room connection. */
  } finally {
    window.dispatchEvent(new Event(huroofSessionsCleared));
  }
}
