import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFirebaseAuth } from '../auth/auth-context';
import { assertOwnerEpoch, isOwnerEpoch, ownerEpoch } from '../enta/auth-epoch';
import { useOwnerGeneration } from '../enta/use-owner-generation';
import { isRoomUuid, parseHuroofRematchPending, parseRematchOwnerAccess, parseHuroofRematchResult } from './huroof-rematch-client';
import { gameRuntime } from './runtime';
import { capabilityFor, forgetRoomCapability, saveCapability, saveRoomCode } from './runtime/huroof-session';
import { LocalRoomCreationFailure } from './runtime/local-realtime-game-adapter';
import { isTerminalRoomError, RoomRequestError, roomRequestError } from './runtime/room-request-error';
import { createGameIntentId } from './runtime/game-intent-id';
import type { SafeRoomSummary } from './runtime/contracts';

type RematchFailure = { message: string; retry: boolean };

function definitiveRematchFailure(reason: unknown): string | undefined {
  if (!(reason instanceof LocalRoomCreationFailure)) return undefined;
  switch (reason.code) {
    case 'LOCAL_REMATCH_SOURCE_UNAVAILABLE': return 'تعذّر استعادة أسئلة المباراة السابقة. اختاروا إعداداً جديداً.';
    case 'LOCAL_REMATCH_NOT_FINISHED': return 'كمّلوا المباراة الحالية قبل ما تلعبون مرة ثانية.';
    case 'LOCAL_REMATCH_ALREADY_STARTED': return 'المضيف بدأ مباراة جديدة من هذه الغرفة.';
    case 'LOCAL_CREATE_SETUP_UNAVAILABLE':
    case 'CATEGORY_GAME_COMBINATION_INVALID':
    case 'QUESTION_SCOPE_INSUFFICIENT_COVERAGE':
      return 'ما بقيت أسئلة كافية لإعادة المباراة. اختاروا إعداداً جديداً.';
    case 'LOCAL_CREATE_REQUEST_INVALID':
    case 'LOCAL_CREATE_KEY_CONFLICT': return 'طلب الإعادة ما عاد صالحاً. اختاروا إعداداً جديداً.';
    default: return undefined;
  }
}

export function useHuroofRematch(roomId?: string) {
  const { user } = useFirebaseAuth();
  const navigate = useNavigate();
  const generation = useOwnerGeneration();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<RematchFailure>();
  const lifecycle = useRef<AbortController>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    inFlight.current = false;
    setBusy(false);
    setFailure(undefined);
    return () => controller.abort();
  }, [roomId, user?.uid, generation]);

  async function start(): Promise<RematchFailure | undefined> {
    const signal = lifecycle.current?.signal;
    if (!signal || signal.aborted || inFlight.current) return;
    if (!user || user.isAnonymous) return { message: 'سجّل دخولك بحساب المضيف عشان تعيد المباراة.', retry: true };
    if (!isRoomUuid(roomId) || !gameRuntime.rematchRoom) return { message: 'تعذّرت إعادة هذه المباراة. اختاروا إعداداً جديداً.', retry: false };
    inFlight.current = true;
    setBusy(true);
    setFailure(undefined);
    const key = `almaidan:huroof-rematch:${user.uid}:${roomId}`;
    let original: string | null = null;
    let epoch: ReturnType<typeof ownerEpoch> | undefined;

    try {
      epoch = ownerEpoch(user.uid);
      original = sessionStorage.getItem(key);
      if (!original) {
        original = JSON.stringify({ uid: user.uid, id: roomId, requestKey: createGameIntentId() });
        sessionStorage.setItem(key, original);
      }
      const { requestKey } = parseHuroofRematchPending(original, user.uid, roomId);
      const capturedEpoch = epoch;
      const assertCurrent = () => {
        assertOwnerEpoch(capturedEpoch, signal);
        if (sessionStorage.getItem(key) !== original) throw new Error('PENDING_CHANGED');
      };
      const idToken = await user.getIdToken();
      assertCurrent();
      let cap = capabilityFor(roomId);
      if (cap?.role !== 'host' || cap.token.length < 20 || cap.token.length > 16384) {
        const response = await fetch(`/api/rooms/${roomId}/owner-access`, {
          method: 'POST', headers: { authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
          body: '{}', signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
        });
        if (!response.ok) throw await roomRequestError(response);
        const data = await response.json();
        assertCurrent();
        cap = parseRematchOwnerAccess(data, roomId);
        saveCapability(roomId, cap);
      }
      const response = await gameRuntime.rematchRoom(roomId, requestKey, { idToken, hostCapability: cap.token, assertCurrent });
      assertCurrent();
      const result = parseHuroofRematchResult(response, roomId);
      saveCapability(result.roomId, { role: 'host', token: result.token });
      saveRoomCode(result.roomCode, result.roomId);
      sessionStorage.removeItem(key);
      navigate(`/room/${result.roomCode}/lobby`);
    } catch (reason) {
      if (signal.aborted || (epoch && !isOwnerEpoch(epoch))) return;
      const definitive = definitiveRematchFailure(reason);
      const hasPendingProblem = reason instanceof Error && reason.message.startsWith('PENDING_');
      const ownerAccessDenied = reason instanceof RoomRequestError && isTerminalRoomError(reason);
      if (reason instanceof LocalRoomCreationFailure && reason.code === 'LOCAL_REMATCH_HOST_REQUIRED') {
        // The original request may already have a receipt. Reauthorize the same request next time.
        forgetRoomCapability(roomId, false);
      }
      if (definitive && original && sessionStorage.getItem(key) === original) sessionStorage.removeItem(key);
      const next = {
        retry: !definitive && !ownerAccessDenied && !hasPendingProblem,
        message: definitive ?? (ownerAccessDenied
          ? 'حسابك الحالي ما يقدر يعيد هذه المباراة.'
          : hasPendingProblem
          ? 'تعذّر التحقق من طلب الإعادة المحفوظ.'
          : 'تعذّر تأكيد الإعادة. حاولوا مرة ثانية لاستعادة نفس الطلب.'),
      };
      setFailure(next);
      return next;
    } finally {
      if (!signal.aborted) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  return { busy, failure, start };
}

export function useCarryHuroofRematch(roomId?: string, successor?: SafeRoomSummary['successor']) {
  const navigate = useNavigate();
  const attempt = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const successorId = successor?.roomId;

  useEffect(() => {
    setBusy(false);
    setFailed(false);
    return () => { attempt.current?.abort(); attempt.current = null; };
  }, [roomId, successorId]);

  async function join() {
    if (!roomId || !successor || !gameRuntime.carryRematch || attempt.current) return;
    const predecessor = capabilityFor(roomId);
    if (predecessor?.role !== 'player') { setFailed(true); return; }
    const controller = new AbortController();
    attempt.current = controller;
    setBusy(true);
    setFailed(false);
    try {
      const { token } = await gameRuntime.carryRematch(roomId, successor.roomId, predecessor.token, controller.signal);
      if (controller.signal.aborted || capabilityFor(roomId)?.token !== predecessor.token) return;
      saveCapability(successor.roomId, { role: 'player', token: token ?? '' });
      saveRoomCode(successor.roomCode, successor.roomId);
      navigate(`/room/${encodeURIComponent(successor.roomCode)}/lobby`, { replace: true });
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (!controller.signal.aborted) { attempt.current = null; setBusy(false); }
    }
  }

  return { busy, failed, join };
}
