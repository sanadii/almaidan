import type { Projection, Room } from './contracts.js';
export function project(room: Room, uid: string, now: number): Projection { if (!room.players.some(p=>p.uid===uid && !p.left)) throw new Error('NOT_MEMBER'); const inRound = ['reveal','clues','discussion','vote','runoff','guess'].includes(room.phase); return {gameKind:'imposter',revision:room.viewVersions?.[uid] ?? 0,code:room.code,phase:room.phase,phaseId:room.phaseId,round:room.round,organizer:room.organizer,me:uid,players:room.players.filter(p=>!p.left || ((inRound || room.phase==='results') && room.order.includes(p.uid))).map(p=>({uid:p.uid,name:p.name,ready:p.ready,connected:!p.left && p.leaseUntil>now})),settings:room.settings,deadline:room.deadline,...(inRound && room.word ? {category:room.word.category,role:room.imposter===uid?'imposter' as const:'insider' as const,...(room.imposter!==uid?{word:room.word.word}:{})}:{}),order:room.order,turn:room.turn,clues:room.clues,candidates:room.candidates,contentExhausted:room.contentExhausted===true,hasActed:room.phase==='reveal'?room.acks.includes(uid):['vote','runoff'].includes(room.phase)?Object.hasOwn(room.votes,uid):false,...(room.phase==='results' && room.result?{result:room.result}:{})}; }


/** Advance only the recipient whose visible projection changed; secret ballot activity is not a shared counter. */
export function refreshViews(room: Room, now: number): void {
  room.viewVersions ??= {}; room.viewKeys ??= {};
  for (const player of room.players) {
    if (player.left) continue;
    const visible = { ...project(room, player.uid, now), revision: 0 };
    const key = JSON.stringify(visible);
    if (room.viewKeys[player.uid] !== key) {
      room.viewKeys[player.uid] = key;
      room.viewVersions[player.uid] = (room.viewVersions[player.uid] ?? 0) + 1;
    }
  }
}

