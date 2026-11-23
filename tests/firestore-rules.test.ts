import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';

const host = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
let environment!: RulesTestEnvironment;
async function setup() {
  environment ??= await initializeTestEnvironment({ projectId: 'demo-huroof-wa-oloof', firestore: { host: host.split(':')[0], port: Number(host.split(':')[1]), rules: await (await import('node:fs/promises')).readFile('firestore.rules', 'utf8') } });
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'rooms/r1'), { config: { demo: false, releaseDemoFixture: false, paidAdmission: { admissionId: 'a1', roomId: 'r1' } } });
    await setDoc(doc(context.firestore(), 'paidAdmissions/a1'), { binding: { admissionId: 'a1', roomId: 'r1' }, state: 'STARTED' });
    await setDoc(doc(context.firestore(), 'rooms/r1/members/u1'), { uid: 'u1', role: 'player', active: true });
    await setDoc(doc(context.firestore(), 'rooms/r1/members/u2'), { uid: 'u2', role: 'player', active: true });
    await setDoc(doc(context.firestore(), 'rooms/r1/members/u3'), { uid: 'u3', role: 'host', active: true });
    await setDoc(doc(context.firestore(), 'rooms/r1/members/u4'), { uid: 'u4', role: 'player', active: false });
    await setDoc(doc(context.firestore(), 'rooms/r1/members/u5'), { uid: 'u5', role: 'audience', active: true });
    await setDoc(doc(context.firestore(), 'rooms/r1/projections/player_u1'), { revision: 1 });
    await setDoc(doc(context.firestore(), 'rooms/r1/projections/player_u2'), { revision: 1 });
    await setDoc(doc(context.firestore(), 'rooms/r1/projections/audience'), { revision: 1 });
    await setDoc(doc(context.firestore(), 'rooms/r1/projections/host'), { revision: 1 });
    await setDoc(doc(context.firestore(), 'rooms/r1/canonical/private'), { canonicalAnswer: 'secret' });
    await setDoc(doc(context.firestore(), 'qaChallengePermits/permit-private'), { immutable: true, hostUid: 'u3' });
    await setDoc(doc(context.firestore(), 'qaChallengePermitUses/permit-private'), { immutable: true, roomId: 'r1', hostUid: 'u3' });
    await setDoc(doc(context.firestore(), 'rooms/r1/qaClosureReceipts/receipt-private'), { immutable: true, actorUid: 'u3' });
    await setDoc(doc(context.firestore(), 'challengeDefinitionSets/manifest-private/definitions/definition-private'), { canonicalJson: 'secret' });
    await setDoc(doc(context.firestore(), 'releases/release-private/mapVariants/map-private'), { runtimeQuestionId: 'map-private' });
  });
}
await setup();
const player = environment.authenticatedContext('u1').firestore();
const hostUser = environment.authenticatedContext('u3').firestore();
const inactive = environment.authenticatedContext('u4').firestore();
const staleAudience = environment.authenticatedContext('u5').firestore();
const anonymous = environment.unauthenticatedContext().firestore();
await assertSucceeds(getDoc(doc(player, 'rooms/r1/projections/player_u1')));
await assertSucceeds(getDoc(doc(player, 'rooms/r1/projections/audience')));
await assertFails(getDoc(doc(player, 'rooms/r1/projections/player_u2')));
await assertFails(getDoc(doc(player, 'rooms/r1/projections/host')));
await assertSucceeds(getDoc(doc(hostUser, 'rooms/r1/projections/host')));
await assertFails(getDoc(doc(inactive, 'rooms/r1/projections/audience')));
await assertFails(getDoc(doc(staleAudience, 'rooms/r1/projections/player_u5')));
await assertSucceeds(getDoc(doc(staleAudience, 'rooms/r1/projections/audience')));
await assertFails(getDoc(doc(anonymous, 'rooms/r1/projections/audience')));
await assertFails(getDoc(doc(player, 'rooms/r1/canonical/private')));
await assertFails(setDoc(doc(player, 'rooms/r1/projections/player_u1'), { revision: 2 }));
await assertFails(getDocs(collection(player, 'rooms/r1/projections')));
// Even valid active members cannot read stale live projections if admission
// is absent, cancelled, points to another room, or differs from the room pins.
await environment.withSecurityRulesDisabled(async (context) => {
  for (const [state, proof] of [
    ['missing', null], ['cancelled', { binding: { admissionId: 'bad-cancelled', roomId: 'bad-cancelled' }, state: 'CANCELLED' }],
    ['mismatched', { binding: { admissionId: 'bad-mismatched', roomId: 'another-room' }, state: 'STARTED' }],
    ['owner', { binding: { admissionId: 'bad-owner', roomId: 'bad-owner', uid: 'intruder' }, state: 'STARTED' }],
  ] as const) {
    const roomId = `bad-${state}`, binding = { admissionId: roomId, roomId };
    await setDoc(doc(context.firestore(), `rooms/${roomId}`), { config: { demo: false, releaseDemoFixture: false, paidAdmission: binding } });
    if (proof) await setDoc(doc(context.firestore(), `paidAdmissions/${roomId}`), proof);
    for (const [member, role] of [['u1', 'player'], ['u3', 'host']] as const) await setDoc(doc(context.firestore(), `rooms/${roomId}/members/${member}`), { uid: member, role, active: true });
    for (const projection of ['host', 'audience', 'player_u1']) await setDoc(doc(context.firestore(), `rooms/${roomId}/projections/${projection}`), { activeQuestion: { promptAr: 'stale', canonicalAnswer: 'secret' } });
  }
});
for (const state of ['missing', 'cancelled', 'mismatched', 'owner']) {
  for (const [context, projection] of [[player, 'player_u1'], [player, 'audience'], [hostUser, 'host'], [hostUser, 'audience']] as const)
    await assertFails(getDoc(doc(context, `rooms/bad-${state}/projections/${projection}`)));
}
// M6 server-only namespaces remain unreadable and unwritable even to a current player or host.
for (const path of [
  'qaChallengePermits/permit-private', 'qaChallengePermitUses/permit-private',
  'rooms/r1/qaClosureReceipts/receipt-private',
  'challengeDefinitionSets/manifest-private/definitions/definition-private',
  'releases/release-private/mapVariants/map-private',
  'paidAdmissions/a1',
]) {
  await assertFails(getDoc(doc(player, path)));
  await assertFails(getDoc(doc(hostUser, path)));
  await assertFails(setDoc(doc(player, path), { forged: true }));
}
await environment.cleanup();
