import { projectRoom, type CanonicalMember, type CanonicalRoom } from "../../../../../functions/src/game.js";
import { assertChallengeDefinitionBinding } from "../../../../../src/features/game/challenges/integration.js";
import type { CanonicalChallengeDefinition } from "../../../../../src/features/game/challenges/definition.js";

/** Audience derives from the current, active server-loaded member, never from a request field. */
export function projectForMember(roomId: string, room: CanonicalRoom, members: CanonicalMember[], actorUid: string, now: number, options?:{view:"member"|"audience";definition?:CanonicalChallengeDefinition}) {
  const matches = members.filter(member => member.uid === actorUid && member.active);
  const actor = matches[0];
  if (matches.length !== 1 || !actor || !Number.isSafeInteger(now) || now < 0) throw new Error("PROJECTION_FORBIDDEN");
  if(options?.view==="audience" && actor.role!=="host" && actor.role!=="audience") throw new Error("PROJECTION_FORBIDDEN");
  if (room.challenge && !room.challenge.continued) {
    const definition=options?.definition, binding=room.activeQuestion?.challenge;
    if(!definition || !binding || room.challenge.definitionId!==definition.id || room.challenge.definitionHash!==definition.definitionSha256 || binding.definition.id!==definition.id || binding.definition.definitionSha256!==definition.definitionSha256 || binding.definition.schemaVersion!==definition.schemaVersion) throw new Error("UNSUPPORTED_CHALLENGE_PROFILE");
    assertChallengeDefinitionBinding(definition,room.activeQuestion!);
  }
  return projectRoom(roomId, room, members, options?.view==="audience"?"audience":actor.role, actor.uid, now,options?.definition);
}
/** The public persisted row is deliberately only an invalidation hint. */
export function publicInvalidation(room: CanonicalRoom) { return { status: room.game.lifecycle, revision: room.revision }; }
