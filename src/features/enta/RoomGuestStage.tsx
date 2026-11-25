import { useCountdownSound, useGameSoundTransition } from '../ui/game-sound';
import { roomSoundCues } from './enta-sound';
import { formatNumber, formatSeconds } from '../../lib/format-number';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RoomCode } from '../../design-system/RoomCode';
import { CanvasBoard } from './CanvasBoard';
import { aidLabels, competitionLeaderIds } from './competition-client';
import { roomError, roomRequest, type RoomView } from './room-client';
import { isDefinitiveRoomActionError, roomAttemptOptions, roomCaptainAids } from './room-player-actions';

function RoomBoard({ match, kids }: { match: any; kids: boolean }) {
  const rows = match.tiles ?? match.rounds ?? [];
  if (!match.categories?.length) return null;
  return <section className={`enta-board${kids ? ' enta-board--kids' : ''}`} aria-label="لوحة الأسئلة">
    {match.categories.map((category: { key: string; label: string }) => <section key={category.key} className="enta-board-column">
      <h2>{category.label}</h2>
      <div>{rows.filter((row: any) => row.categoryKey === category.key).map((row: any) => {
        const used = row.used ?? (row.phase === 'RESOLVED' || row.state === 'RESOLVED');
        const label = row.isCorrect ? match.teams.find((team: any) => team.id === row.answeredByTeamId)?.name ?? 'احتُسبت' : row.isCorrect === false ? 'بلا نقاط' : 'لُعبت';
        return <div key={row.id} className="enta-tile enta-room-tile" data-used={used} data-result={used && row.isCorrect != null ? row.isCorrect ? 'scored' : 'missed' : undefined}>
          <span>{row.points == null ? `جولة ${formatNumber(row.ordinal + 1)}` : formatNumber(row.points)}</span>{used ? <small>{label}</small> : null}
        </div>;
      })}</div>
    </section>)}
  </section>;
}

function RoomResult({ match, display }: { match: any; display: boolean }) {
  const result = match.result?.payload ?? match.result;
  const winners: string[] = Array.isArray(result?.scores) && Array.isArray(result?.winnerParticipantIds)
    ? competitionLeaderIds(result) : result?.winnerParticipantIds ?? result?.winnerTeamIds ?? [];
  const tied = result?.isTie || result?.outcome === 'UNRESOLVED_TIE' || winners.length > 1;
  const names = match.teams?.filter((team: any) => winners.includes(team.id)).map((team: any) => team.name).join('، ');
  return <section className="enta-question enta-room-result">
    <h2>{tied ? 'انتهت المباراة بالتعادل' : names ? `الفائز: ${names}` : 'انتهت المباراة'}</h2>
    <p>{result?.unplayedCount > 0 ? `بقي ${result.unplayedCount} سؤال أو جولة ما لعبتوها.` : 'اكتملت المباراة.'}</p>
    {!display ? <Link className="button" to="/">الرئيسية</Link> : null}
  </section>;
}

export function RoomGuestStage({ room, token, display = false, connected = true, refresh, joinUrl }: {
  room: RoomView; token: string; display?: boolean; connected?: boolean; refresh: () => void; joinUrl: string;
}) {
  const match = room.match as any;
  const current = match?.currentQuestion ?? match?.currentRound;
  const member = room.members.find(row => row.id === room.self?.id);
  const [submittedText, setSubmittedText] = useState('');
  const [privateState, setPrivateState] = useState<{ roundId: string; capability: any } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const receivedAt = useRef(Date.now());
  const pending = useRef<Record<string, unknown> | null>(null);
  const inFlight = useRef(false);
  const active = room.phase === 'PLAYING';
  const soundRole = display ? 'display' : 'player';
  const deadline = Math.min(current?.deadlineAt ?? Infinity, current?.deadline ?? Infinity, current?.turnDeadline ?? Infinity, current?.overallDeadline ?? Infinity);
  const remaining = Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - (match.serverNow + Math.max(0, clock - receivedAt.current))) / 1000)) : null;
  const revealed = match?.phase === 'REVEALED' || current?.state === 'AWAITING_RULING' || current?.phase === 'AWAITING_RULING' || current?.publicRevealed || current?.revealed;
  const timed = connected && active && !revealed && !current?.pause && current?.state !== 'PAUSED' && remaining !== null;
  useCountdownSound(soundRole, timed ? `${room.code}:${current?.id}:${deadline}` : null, timed ? remaining : null, deadline,
    connected && !current?.pause && current?.state !== 'PAUSED' ? match?.serverNow : undefined);
  useGameSoundTransition(soundRole, connected ? room : null, roomSoundCues);
  const canReadPrivate = !display && active && ['competitive', 'round'].includes(room.engine) && room.self?.hasPrivateGrant !== false && !!current;
  const privateView = canReadPrivate && privateState?.roundId === current?.id ? privateState?.capability : null;

  useEffect(() => {
    receivedAt.current = Date.now();
    setClock(receivedAt.current);
  }, [match?.serverNow]);

  useEffect(() => {
    if (!active) return;
    let interval: ReturnType<typeof setInterval> | undefined;
    function update() {
      clearInterval(interval);
      if (document.hidden) return;
      setClock(Date.now());
      interval = setInterval(() => setClock(Date.now()), 200);
    }
    update();
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', update); };
  }, [active]);

  useEffect(() => {
    if (!canReadPrivate) return;
    let controller: AbortController | undefined;
    function read() {
      controller?.abort();
      setPrivateState(null);
      if (document.hidden) return;
      controller = new AbortController();
      const signal = controller.signal;
      void roomRequest(`/${room.code}/private`, { token, signal }).then(data => {
        if (!signal.aborted && data.capability) setPrivateState({ roundId: current.id, capability: data.capability });
      }).catch(() => {});
    }
    read();
    document.addEventListener('visibilitychange', read);
    return () => { controller?.abort(); document.removeEventListener('visibilitychange', read); };
  }, [canReadPrivate, current?.id, match?.version, room.code, room.version, token]);

  useEffect(() => {
    if (!privateView?.grant) return;
    const lifetime = Math.min(privateView.grant.expiresAt, privateView.deadline ?? privateView.deadlineAt ?? Infinity) - privateView.serverNow;
    const timer = setTimeout(() => setPrivateState(null), Math.max(0, lifetime));
    return () => clearTimeout(timer);
  }, [privateView]);

  async function act(type: string, extra: Record<string, unknown> = {}) {
    if (inFlight.current || !match) return;
    if (room.actionsVersion !== 2) { setError(new Error('ROOM_ACTIONS_UPGRADE_REQUIRED')); return; }
    if (pending.current && (type !== pending.current.type || extra.aid !== undefined && extra.aid !== pending.current.aid || extra.itemId !== undefined && extra.itemId !== pending.current.itemId)) return;
    pending.current ??= { commandId: crypto.randomUUID(), expectedVersion: match.version, roundId: match.currentRound?.id, type, ...(type === 'USE_AID' ? {} : { submittedText }), ...extra };
    inFlight.current = true;
    setBusy(true);
    try {
      await roomRequest(`/${room.code}/actions`, { token, body: pending.current });
      pending.current = null;
      setSubmittedText('');
      setError(null);
    } catch (failure) {
      setError(failure);
      if (isDefinitiveRoomActionError(failure)) pending.current = null;
    } finally {
      inFlight.current = false;
      setBusy(false);
      refresh();
    }
  }

  if (!match) return <section className={display ? 'enta-stage enta-display-lobby' : 'enta-state enta-room-lobby'}>
    {display ? <><h1>ادخلوا من جوالاتكم</h1><RoomCode code={room.code} joinUrl={joinUrl} large copyEnabled={false} /></>
      : <><RoomCode code={room.code} joinUrl={joinUrl} /><p className="enta-room-status" role="status">{member?.status === 'PENDING' ? 'بانتظار قبول المضيف' : 'بانتظار بدء المباراة'}</p></>}
    {room.members.length ? <ul className="enta-room-names" aria-label="اللاعبون">{room.members.map(row => <li key={row.id}><bdi>{row.name}</bdi>{!display && row.id === room.self?.id ? ' (أنت)' : ''}</li>)}</ul> : null}
  </section>;

  const teamId = current?.answeringTeamId ?? current?.currentTeamId ?? current?.scoringTeamId ?? match.turnTeamId;
  const teamName = match.teams?.find((team: any) => team.id === teamId)?.name;
  const turn = teamName ? `الدور على ${teamName}` : 'المضيف يختار الجولة التالية';
  const feedbackAge = match.serverNow + Math.max(0, clock - receivedAt.current) - (room.feedback?.at ?? 0);
  const feedback = active && room.feedback && feedbackAge < 3000 ? room.feedback : null;
  const scoreMessage = feedback && (feedback.awards.length ? feedback.awards.map(award => {
    const name = match.teams.find((team: any) => team.id === award.teamId)?.name;
    return `${award.points > 0 ? '+' : '−'}${Math.abs(award.points)}${name ? ` لـ${name}` : ''}`;
  }).join('، ') : 'ما أحد جاوب صح');
  let phaseMessage = turn;
  if (room.phase === 'FINISHED') phaseMessage = 'انتهت المباراة';
  else if (current) {
    if (current.pause || current.state === 'PAUSED') phaseMessage = 'الجولة متوقفة مؤقتاً';
    else if (remaining === 0 && !revealed || current.phase === 'AWAITING_RULING' && !current.publicRevealed) phaseMessage = 'انتهى الوقت';
    else if (revealed) phaseMessage = 'بانتظار الحكم';
    else if (current.phase === 'STEAL') phaseMessage = 'الفرصة للفرق الأخرى';
    else phaseMessage = `${turn} · السؤال مفتوح`;
  }
  const categoryKey = (match.tiles ?? match.rounds)?.find((row: any) => row.id === current?.id)?.categoryKey;
  const categoryName = match.categories?.find((category: any) => category.key === categoryKey)?.label;
  const attempts = roomAttemptOptions(room, display);
  const captainAids = roomCaptainAids(room, display);
  const ownSubmissions = room.submissions?.filter(row => row.memberId === room.self?.id).slice(-10) ?? [];
  const transport = (path: string, signal: AbortSignal, body?: unknown) => roomRequest(`/${room.code}/${privateView?.canvas ? 'canvas' : 'public-canvas'}${path.includes('?') ? path.slice(path.indexOf('?')) : ''}`, { token, signal, body });
  const timer = !revealed && remaining !== null && remaining > 0
    ? <p className="enta-timer" role="timer" aria-label="الوقت المتبقي">{formatSeconds(remaining)}</p>
    : null;

  return <div className="enta-play enta-room-play">
    <ol className="enta-scores" aria-label="نقاط الفرق">{match.teams?.map((team: any) => <li key={team.id} data-turn={active && team.id === teamId}><span><bdi>{team.name}</bdi></span><strong>{formatNumber(team.score ?? 0)}</strong></li>)}</ol>
    <p className="enta-room-status" role="status">{scoreMessage || phaseMessage}</p>
    {room.phase === 'FINISHED' ? <RoomResult match={match} display={display} /> : current ? <section className="enta-question" aria-labelledby="enta-room-question-title">
      {categoryName || current.points != null ? <div className="enta-section-heading">{categoryName ? <p>{categoryName}</p> : null}{current.points != null ? <p>{formatNumber(current.points)} نقطة</p> : null}</div> : null}
      {display ? timer : null}
      <h2 id="enta-room-question-title">{current.prompt ?? current.question?.prompt ?? 'جولة جارية'}</h2>
      {display ? null : timer}
      {current.answers ? <div className="enta-answer"><h3>الإجابة</h3><p>{current.answers.map((answer: any) => typeof answer === 'string' ? answer : answer.text).join('، ')}</p></div> : null}
      {!display && ['competitive', 'round'].includes(room.engine) && room.actionsVersion !== 2 ? <p role="status">إرسال الإجابات من الجوال غير متاح. قولوا إجاباتكم للمضيف.</p> : null}
      {!display ? <p>{['competitive', 'round'].includes(room.engine) ? 'اكتبوا إجابتكم وأرسلوها للمضيف.' : 'قولوا الإجابة بصوت واضح. المضيف يعتمد النتيجة.'}</p> : null}
      {attempts.length > 0 && remaining !== 0 ? <div><label>إجابتك<textarea value={submittedText} maxLength={500} disabled={busy || Boolean(pending.current)} onChange={event => setSubmittedText(event.target.value)} /></label><div className="enta-actions">{attempts.map(option => <button key={option.itemId ?? 'target'} className="button button--primary" type="button" disabled={busy || Boolean(pending.current) || !submittedText.trim()} onClick={() => void act(room.engine === 'round' ? 'SUBMIT_ANSWER' : 'RECORD_ATTEMPT', { itemId: option.itemId })}>{option.label}</button>)}</div></div> : null}
      {captainAids.length > 0 && remaining !== 0 ? <div className="enta-actions" aria-label="مساعدات قائد الفريق">{captainAids.map(aid => <button key={aid.id} className="button" type="button" disabled={busy} onClick={() => void act('USE_AID', { aid: aid.aid })}>{aidLabels[aid.aid as keyof typeof aidLabels]}</button>)}</div> : null}
      {current.hints?.length ? <ul>{current.hints.map((hint: any, index: number) => <li key={hint.id ?? index}>{hint.text}</li>)}</ul> : null}
      {current.graphemeHints?.length ? <p>{current.graphemeHints.map((hint: any) => hint.grapheme).join(' ')}</p> : null}
      {privateView?.target ? <aside className="enta-state"><h3>مهمتك الخاصة — لا تعرضها للفريق</h3><p>{privateView.target}</p></aside> : null}
      {current.format === 'DRAWING_TARGET' ? <CanvasBoard authority={{ gameId: room.matchId, competition: room.engine === 'competitive' }} roundId={current.id} revision={privateView?.canvas?.revision ?? current.canvas?.revision ?? 0} epoch={`${room.code}:${current.id}:${privateView?.grant?.id ?? 'public'}`} writable={Boolean(privateView?.canvas) && !display} requestOverride={transport} /> : null}
    </section> : display ? <div className="enta-stage"><RoomBoard match={match} kids={room.engine === 'kids'} /></div> : null}
    {!display && ownSubmissions.length ? <section className="enta-state"><h2>إجاباتك المرسلة</h2><ul>{ownSubmissions.map(row => <li key={row.commandId}><bdi>{row.text}</bdi> — أُرسلت للمضيف</li>)}</ul></section> : null}
    {!display && error ? <div className="enta-state"><p role="alert">{roomError(error)}</p>{pending.current ? <button className="button" type="button" disabled={busy} onClick={() => void act(String(pending.current?.type))}>تأكيد الإجراء نفسه</button> : null}</div> : null}
  </div>;
}
