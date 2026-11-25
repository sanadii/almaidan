export function roomErrorCode(reason: unknown): string {
  const message = typeof reason === 'string' ? reason : reason instanceof Error ? reason.message : '';
  try {
    const parsed = JSON.parse(message);
    if (typeof parsed?.error === 'string') return parsed.error;
  } catch { /* Firebase callable and legacy plain-text errors use the message directly. */ }
  return message.replace(/^Error:\s*/, '');
}

export class RoomRequestError extends Error {
  constructor(readonly status: number, code: string) { super(code); }
}

export async function roomRequestError(response: Response) {
  let code = `HTTP_${response.status}`;
  try { code = roomErrorCode(await response.text()) || code; }
  catch { /* The HTTP status is authoritative even if the error body is unavailable. */ }
  return new RoomRequestError(response.status, code);
}

export function isTerminalRoomError(reason: unknown) {
  const transportCode = reason instanceof Error && 'code' in reason && typeof reason.code === 'string' ? reason.code.split('/').at(-1) : undefined;
  return (reason instanceof RoomRequestError && [401, 403, 404].includes(reason.status)) ||
    /^(UNAUTHORIZED|SEAT_REMOVED|NOT_MEMBER|ROOM_NOT_FOUND|NO_ROOM_SESSION|permission-denied|not-found|unauthenticated)$/.test(transportCode || roomErrorCode(reason));
}
