import { gameRuntime } from './index';
import { parseRoomLocator } from './room-locator';
import { roomErrorCode } from './room-request-error';
import { requestRoomJoinOptions } from '../../enta/room-client';
import { imposterRuntimeKind, resolveRoom } from '../../imposter/runtime';
import { westernDigits } from '../../../lib/format-number';

export const unknownRoomMessage = 'ما لقينا غرفة بهذا الرمز. تأكدوا منه مع المضيف.';
export const roomCheckUnavailableMessage = 'ما قدرنا نتحقق من الرمز. جرّبوا مرة ثانية.';

type FinishedRoom = { status: 'finished'; successorCode?: string };
export type RoomCodeCheck = { status: 'active' } | FinishedRoom | { status: 'error'; message: string };
const unavailable = { status: 'error', message: roomCheckUnavailableMessage } as const;
const missing = { status: 'error', message: unknownRoomMessage } as const;

function finishedHuroofRoom(code: string, successor: unknown): FinishedRoom {
  return typeof successor === 'string' && successor !== code && /^[A-Z0-9]{2,8}$/.test(successor)
    ? { status: 'finished', successorCode: successor } : { status: 'finished' };
}

export function normalizeRoomCode(value: string) {
  const upper = westernDigits(value).toUpperCase();
  if (/^(?:M2|E1|D1)-/.test(upper)) {
    return upper.slice(0, 3) + upper.slice(3).replace(/[^A-Z0-9]/g, '').slice(0, 8);
  }
  return upper.replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export function roomIsMissing(error: unknown) {
  const usesCallableCode = error instanceof Error && 'code' in error && error.code === 'functions/not-found';
  return usesCallableCode || /^(?:ROOM_NOT_FOUND|Room not found\.)$/.test(roomErrorCode(error));
}

export function canCheckRoomCode(code: string) {
  if (code.startsWith('D1-')) return imposterRuntimeKind() === 'local';
  if (code.startsWith('M2-')) return false;
  return code.startsWith('E1-') || gameRuntime.kind === 'local' || gameRuntime.kind === 'firebase';
}

export async function checkRoomCode(code: string, signal: AbortSignal): Promise<RoomCodeCheck> {
  let locator: ReturnType<typeof parseRoomLocator>;
  try { locator = parseRoomLocator(code); }
  catch { return missing; }

  try {
    if (locator.backend === 'enta') {
      const options = await requestRoomJoinOptions(code, signal);
      if (options.finished) return { status: 'finished', successorCode: options.successorCode };
    } else if (code.startsWith('D1-') && imposterRuntimeKind() === 'local') {
      await resolveRoom(code, signal);
    } else if (locator.backend === 'legacy' && gameRuntime.kind === 'local' && !code.startsWith('D1-')) {
      const response = await fetch(`/api/rooms/${encodeURIComponent(code)}/exists`, { signal, cache: 'no-store' });
      if (response.status === 404) return missing;
      if (response.status === 200) {
        const data = await response.json();
        return data?.finished === true ? finishedHuroofRoom(code, data.successorCode) : unavailable;
      }
      if (response.status !== 204) return unavailable;
    } else if (locator.backend === 'legacy' && gameRuntime.kind === 'firebase' && !code.startsWith('D1-')) {
      if (!/^[A-Z0-9]{8}$/.test(code)) return missing;
      if (!gameRuntime.lookupRoomCode) return unavailable;
      const lookup = await gameRuntime.lookupRoomCode(code);
      if (!lookup.exists) return missing;
      if (lookup.finished) return finishedHuroofRoom(code, lookup.successorCode);
    }
  } catch (error) {
    return roomIsMissing(error) ? missing : unavailable;
  }
  return { status: 'active' };
}
