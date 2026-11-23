import { createHash } from 'node:crypto';
import { admissionHash } from '../admission/huroof-protocol.cjs';
import type { CompetitionPrompt, HintProof } from './competition-types';
import type { PromptPin } from './types';

export const CONTENT01_ANCHORS = Object.freeze({
  approval: 'c8f5aa4e6d326c57a206a7c0cbf83a5cd91293cf23ba5974f7bc185a4976e54e',
  bindings: '45e1201161a5c8da84f5181cb1162304552b52d1d3a487fcfd6db37426d04300',
  contentReview: 'e6214ee9678e3ef7234069217c68e0668bc36453a0422efe8b4b98aab9724581',
  draft: '3560a48c53bb8148409718df42c6ebf9dc63718f63d24168922e68ea4f2971b5',
  expansion: '5f8b4df9dc30c7e0fdd01d8723300bd7daecb269f671c8f34129b8e91b3441b8',
  settingsJson: '43a4ad6129fc274b44fc7049d77db52784a01aad41a501d4e1bd29fb1f7f41b0',
  settingsMarkdown: '91c84f676b97a95482bf2b172751ceb5d16d572be672a83945e44fe85f3c74be',
});

const CONTENT01_INPUT_PATHS = Object.freeze({
  approval: 'output/content-owner-review-20261025/private/OWNER-AUTHORING-APPROVAL.json',
  bindings: 'output/pro259-content-20261025/private/ROOT-REVIEW-BINDINGS.json',
  contentReview: 'output/comp02-prerequisites-20261022/package/private/CONTENT-REVIEW-CARDS.md',
  draft: 'output/comp02-prerequisites-20261022/package/private/content/LIST-DRAFT.json',
  expansion: 'output/comp02-prerequisites-20261022/package/private/content/LIST-EXPANSION.json',
  settingsJson: 'output/content-owner-review-20261025/private/REVIEW-SETTINGS-PROPOSAL.json',
  settingsMarkdown: 'output/content-owner-review-20261025/private/REVIEW-SETTINGS-PROPOSAL.md',
});

export interface BoundRaw { raw: string; sha256: string }
export interface ApprovedListInputs {
  approval: BoundRaw;
  bindings: BoundRaw;
  contentReview: BoundRaw;
  draft: BoundRaw;
  expansion: BoundRaw;
  settingsJson: BoundRaw;
  settingsMarkdown: BoundRaw;
}
export interface ApprovedListSettings {
  categoryLabel: string;
  modes: readonly ['STANDALONE_LIST', 'MIXED_BOARD'];
  itemValue: 100;
  wrongAnswerDelta: 0;
  duplicateCredit: false;
  traps: false;
  standaloneTurnSeconds: 45;
  standaloneOverallSeconds: 300;
  embeddedSharedSeconds: 40;
  generalSuggestedAge: 12;
  advancedSuggestedAge: 16;
  ageRecommendationsPlaytested: false;
  textOnly: true;
  embeddedAids: readonly ['PHONE_A_FRIEND', 'MORE_HINT', 'PICK_ANSWERER', 'STEAL_POINTS'];
  standaloneAids: readonly ['HINT', 'PASS', 'FREEZE', 'DOUBLE', 'PHONE'];
  embeddedStealCap: 200;
  standaloneHintRequiresExternalGrapheme: true;
  orderIsHostAdjudicated: true;
  publicationAllowed: false;
  selectorEligible: false;
  R6: 'STOP';
}
export interface AuthoringMetadata {
  cardId: string;
  sourceRevisionSha256: string;
  sourceRowHash: string;
  sourceUrl: string;
  sourceObservedAt: string | null;
  sourceVerification: unknown | null;
  historicalSource: {
    document: 'LIST-DRAFT.json' | 'LIST-EXPANSION.json';
    status: 'HELD';
    publicationAllowed: false;
    selectorEligible: false;
    rightsStatus: 'UNREVIEWED';
    editorialHold: string;
  };
  authoringDecision: 'APPROVED_BY_OWNER';
  rules: unknown;
  aliases: Record<string, string[]>;
  aliasConvenienceCoverage: 'PARTIAL_CONVENIENCE_ONLY';
  exclude: string[];
  exclusionConvenienceCoverage: 'PARTIAL_CONVENIENCE_ONLY';
  orderRequired: boolean;
  ageRecommendation: { suggestedAge: 12 | 16; basis: 'EDITORIAL_NOT_PLAYTESTED' };
  rights: {
    decision: 'OWNER_CONFIRMED_COMMERCIAL_USE';
    scope: string;
    externalMediaRightsGranted: false;
  };
  ownerApproval: {
    path: string;
    sha256: string;
    reviewer: string;
    recordedAtKuwait: string;
    cardBinding: { cardId: string; sourceRevisionSha256: string; queueDeclaredRowHash: string };
  };
  rootBinding: { path: string; sha256: string; kind: string; reviewer: string; scope: string; cardAuthorizationEvidence: unknown };
  settingsApproval: {
    jsonPath: string;
    jsonSha256: string;
    markdownPath: string;
    markdownSha256: string;
    decisionId: string;
    proposalId: string;
    decision: 'APPROVED_BY_OWNER';
    reviewer: string;
    recordedAtKuwait: string;
    authorizationEvidence: unknown;
    approvedComponents: string[];
  };
  parents: { name: string; path: string; sha256: string }[];
}
export interface ApprovedListOutput {
  revisionId: string;
  revisionHash: string;
  categoryKey: string;
  settings: ApprovedListSettings;
  pins: PromptPin[];
  descriptors: CompetitionPrompt[];
  metadata: AuthoringMetadata[];
  lookup(input: { revisionId: string; revisionHash: string; cardId: string; answerId?: string }): AuthoringMetadata | null;
}

const fail = (code: string): never => { throw new Error(code); };
const digest = (raw: string) => createHash('sha256').update(raw, 'utf8').digest('hex');
const hash = (value: unknown) => admissionHash(value);
const exactHash = (input: BoundRaw, expected: string): unknown => {
  if (!input || typeof input.raw !== 'string' || digest(input.raw) !== expected || input.sha256 !== expected) fail('CONTENT01_TRUST_ANCHOR_MISMATCH');
  return JSON.parse(input.raw) as unknown;
};
const id = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_');
const canonicalize = (value: string) => value.normalize('NFC');
function immutable<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) immutable(child);
  }
  return value;
}
function aliasesFor(rules: any): Record<string, string[]> {
  const aliases: Record<string, string[]> = {};
  for (const [canonical, accepted] of Object.entries(rules.acceptedNames ?? rules.acceptedVariants ?? {})) aliases[canonical] = [...(accepted as string[])];
  if (rules.mapping) for (const [canonical, mapped] of Object.entries(rules.mapping)) aliases[canonical] = [String(mapped)];
  if (rules.beautyIsAliasOf === 'bottom') aliases['القاعي'] = [...new Set([...(aliases['القاعي'] ?? []), 'القعري', 'bottom', 'beauty'])];
  if (rules.acceptedEnglishNames) aliases['#english'] = [...rules.acceptedEnglishNames];
  if (rules.acceptedEnglish) aliases['#english'] = [...rules.acceptedEnglish];
  if (rules.explicitExample) aliases[rules.explicitExample.canonical] = [rules.explicitExample.acceptedVariant];
  if (rules.acceptOmissionOfPrefix) aliases['#optional-prefix'] = [rules.acceptOmissionOfPrefix];
  if (rules.arabicTransliterations) aliases['#approved-arabic-transliterations'] = [...(rules.arabicTransliterations.match(/القاعي|القعري/g) ?? [])];
  if (rules.acceptedNamesWithoutDiacritics || rules.acceptNamesWithoutDiacritics || rules.ignoreDiacritics) aliases['#diacritics'] = ['ACCEPT_OMITTED'];
  return aliases;
}

const expectedComponents = [
  'Canonical mixed-topic LIST12 membership/category proposal',
  '100points percorrectitem,zero unlistedwronganswerdeduction,noduplicates/notraps',
  '45secondstandaloneturn/300secondactiveoverallcap;40secondembeddedsharedtime',
  'LISTstandalone+embeddedmodefit;proposed12+/16+editorialgroupings',
  'Text-only,noexternalmedia',
  'Existing aid rules and200pointembeddedstealcap unchanged',
  '12exact displayed authored text hints',
  'Card12canonicalالقاعي;acceptedالقعريandBottom/Beauty',
];

/** Pure, unmounted successor producer. The caller supplies raw anchored bytes;
 * this module has no filesystem, network, issuer, or activation behavior. */
export function produceApprovedListContent(input: ApprovedListInputs): ApprovedListOutput {
  const approval = exactHash(input.approval, CONTENT01_ANCHORS.approval) as any;
  const bindings = exactHash(input.bindings, CONTENT01_ANCHORS.bindings) as any;
  if (!input.contentReview || digest(input.contentReview.raw) !== CONTENT01_ANCHORS.contentReview || input.contentReview.sha256 !== CONTENT01_ANCHORS.contentReview) fail('CONTENT01_TRUST_ANCHOR_MISMATCH');
  const draft = exactHash(input.draft, CONTENT01_ANCHORS.draft) as any;
  const expansion = exactHash(input.expansion, CONTENT01_ANCHORS.expansion) as any;
  const settingsProposal = exactHash(input.settingsJson, CONTENT01_ANCHORS.settingsJson) as any;
  if (!input.settingsMarkdown || digest(input.settingsMarkdown.raw) !== CONTENT01_ANCHORS.settingsMarkdown || input.settingsMarkdown.sha256 !== CONTENT01_ANCHORS.settingsMarkdown) fail('CONTENT01_TRUST_ANCHOR_MISMATCH');

  const rows = [...draft.candidates, ...expansion.candidates];
  const approved = approval.cardApprovalBindings as any[];
  const bound = bindings.cards as any[];
  const hints = settingsProposal.cardTextHints as any[];
  const settingsApproval = approval.settingsDecision;
  const sourceInputs = approval.sourceInputs as any[];
  if (rows.length !== 12 || approved.length !== 12 || bound.length !== 12 || hints.length !== 12) fail('CONTENT01_CARD_BIJECTION');
  if (JSON.stringify(settingsApproval.approvedComponents) !== JSON.stringify(expectedComponents)
    || settingsApproval.decision !== 'APPROVED_BY_OWNER'
    || settingsApproval.proposalId !== 'LIST12-SETTINGS-PROPOSAL-20261025'
    || settingsApproval.proposalJson?.sha256 !== CONTENT01_ANCHORS.settingsJson
    || settingsApproval.readableProposal?.sha256 !== CONTENT01_ANCHORS.settingsMarkdown) fail('CONTENT01_SETTINGS_NOT_APPROVED');
  const expectedOriginalInputs = [
    ['CONTENT-REVIEW-CARDS.md', CONTENT01_ANCHORS.contentReview],
    ['LIST-DRAFT.json', CONTENT01_ANCHORS.draft],
    ['LIST-EXPANSION.json', CONTENT01_ANCHORS.expansion],
  ];
  if (expectedOriginalInputs.some(([suffix, sha]) => !sourceInputs.some((source: any) => source.path.endsWith(suffix) && source.sha256 === sha))) fail('CONTENT01_SOURCE_ANCESTRY_MISMATCH');

  const categoryKey = 'approved_list_12';
  const revisionId = 'approved_list_content01_r2';
  const metadata: AuthoringMetadata[] = [];
  const descriptors: CompetitionPrompt[] = [];
  for (const [index, row] of rows.entries()) {
    const cardId = row.id as string;
    const approvalRow = approved.find((entry: any) => entry.cardId === cardId);
    const binding = bound.find((entry: any) => entry.cardId === cardId);
    const hint = hints.find((entry: any) => entry.cardId === cardId);
    const expectedSourceRevision = index < 6 ? CONTENT01_ANCHORS.draft : CONTENT01_ANCHORS.expansion;
    if (!approvalRow || !binding || !hint
      || approvalRow.editorial !== 'APPROVED_BY_OWNER'
      || approvalRow.judgingRules !== 'APPROVED_BY_OWNER'
      || approvalRow.rights?.decision !== 'OWNER_CONFIRMED_COMMERCIAL_USE'
      || approvalRow.sourceRevisionSha256 !== expectedSourceRevision
      || binding.sourceRevisionSha256 !== approvalRow.sourceRevisionSha256
      || binding.queueDeclaredRowHash !== approvalRow.queueDeclaredRowHash
      || approvalRow.queueDeclaredRowHash !== hash(row)) fail('CONTENT01_APPROVAL_JOIN');

    let answerTexts = [...row.answers] as string[];
    if (cardId === 'int4-list-draft-012') answerTexts = answerTexts.map(answer => answer === 'القعري' ? 'القاعي' : answer);
    const cardRevision = `${id(cardId)}_r1`;
    const items = answerTexts.map((answer, ordinal) => {
      const item = {
        id: `${id(cardId)}_a${ordinal + 1}`,
        revisionId: `${id(cardId)}_a${ordinal + 1}_r1`,
        hash: '', ordinal, text: canonicalize(answer), value: 100, trap: false, mediaIds: [] as string[],
      };
      const { hash: ignored, ...answerMaterial } = item;
      void ignored;
      item.hash = hash(answerMaterial);
      return item;
    });
    const basePin = {
      ref: `${id(cardId)}_prompt`, sourceNamespace: 'huroof-approved-list', sourceId: cardId,
      revisionId: cardRevision, hash: '', formatId: `${id(cardId)}_format`, formatHash: '',
      categoryKey, format: 'LIST_ITEMS' as const, prompt: canonicalize(row.prompt), target: null,
      points: null, items, media: [], rules: { version: 1 as const, kind: 'LIST_ITEMS' as const, target: null },
    };
    basePin.hash = hash({ cardId, revisionId: cardRevision, prompt: basePin.prompt, items });
    const { formatHash, ...formatMaterial } = basePin;
    void formatHash;
    basePin.formatHash = hash({ version: 1, pin: formatMaterial });

    const hintProof: HintProof = {
      id: `${id(cardId)}_hint1`, revisionId: cardRevision, revisionHash: basePin.hash, ordinal: 0,
      text: canonicalize(hint.text), contentHash: hash({ ordinal: 0, text: canonicalize(hint.text) }), safeDrawing: false,
    };
    const descriptor: CompetitionPrompt = {
      ...basePin, hints: [hintProof], graphemes: [], hintRoot: '', effectValue: 200,
      effectValueSource: 'OWNER_EMBEDDED_200', proofHash: '',
    };
    descriptor.hintRoot = hash({ hints: descriptor.hints, graphemes: descriptor.graphemes });
    descriptor.proofHash = hash({
      version: 'enta-competitive-1', baseHash: hash(basePin), hints: descriptor.hints,
      graphemes: descriptor.graphemes, hintRoot: descriptor.hintRoot,
      effectValue: descriptor.effectValue, effectValueSource: descriptor.effectValueSource,
    });
    descriptors.push(descriptor);

    const sourceUpdate = (approval.sourceVerificationUpdates as any[]).find(update => update.cardId === cardId) ?? null;
    const audience = settingsProposal.settings.audience;
    const age = (audience.generalCards.includes(index + 1) ? audience.generalSuggestedAge : audience.advancedSuggestedAge) as 12 | 16;
    const rights = approvalRow.rights;
    metadata.push({
      cardId, sourceRevisionSha256: approvalRow.sourceRevisionSha256,
      sourceRowHash: approvalRow.queueDeclaredRowHash, sourceUrl: row.source,
      sourceObservedAt: row.sourceObservedAt ?? null, sourceVerification: sourceUpdate,
      historicalSource: {
        document: index < 6 ? 'LIST-DRAFT.json' : 'LIST-EXPANSION.json',
        status: 'HELD', publicationAllowed: false, selectorEligible: false,
        rightsStatus: 'UNREVIEWED', editorialHold: row.editorialHold,
      },
      authoringDecision: 'APPROVED_BY_OWNER',
      rules: structuredClone(binding.approvedJudgingRules), aliases: aliasesFor(binding.approvedJudgingRules),
      aliasConvenienceCoverage: 'PARTIAL_CONVENIENCE_ONLY',
      exclude: [...(binding.approvedJudgingRules.exclude ?? binding.approvedJudgingRules.excludeExamples ?? [])],
      exclusionConvenienceCoverage: 'PARTIAL_CONVENIENCE_ONLY',
      orderRequired: binding.approvedJudgingRules.orderRequired === true,
      ageRecommendation: { suggestedAge: age, basis: 'EDITORIAL_NOT_PLAYTESTED' },
      rights: { decision: rights.decision, scope: rights.scope, externalMediaRightsGranted: false },
      ownerApproval: {
        path: CONTENT01_INPUT_PATHS.approval, sha256: CONTENT01_ANCHORS.approval,
        reviewer: approval.reviewer.displayName, recordedAtKuwait: approval.recordedAtKuwait,
        cardBinding: {
          cardId, sourceRevisionSha256: approvalRow.sourceRevisionSha256,
          queueDeclaredRowHash: approvalRow.queueDeclaredRowHash,
        },
      },
      rootBinding: {
        path: CONTENT01_INPUT_PATHS.bindings, sha256: CONTENT01_ANCHORS.bindings,
        kind: bindings.kind, reviewer: bindings.reviewer, scope: bindings.scope,
        cardAuthorizationEvidence: structuredClone(binding.authorizationEvidence),
      },
      settingsApproval: {
        jsonPath: CONTENT01_INPUT_PATHS.settingsJson, jsonSha256: CONTENT01_ANCHORS.settingsJson,
        markdownPath: CONTENT01_INPUT_PATHS.settingsMarkdown, markdownSha256: CONTENT01_ANCHORS.settingsMarkdown,
        decisionId: settingsApproval.decisionId, proposalId: settingsApproval.proposalId,
        decision: settingsApproval.decision, reviewer: settingsApproval.reviewer.displayName,
        recordedAtKuwait: settingsApproval.recordedAtKuwait,
        authorizationEvidence: structuredClone(settingsApproval.authorizationEvidence),
        approvedComponents: [...settingsApproval.approvedComponents],
      },
      parents: [
        { name: 'draft', path: CONTENT01_INPUT_PATHS.draft, sha256: CONTENT01_ANCHORS.draft },
        { name: 'expansion', path: CONTENT01_INPUT_PATHS.expansion, sha256: CONTENT01_ANCHORS.expansion },
        { name: 'content-review', path: CONTENT01_INPUT_PATHS.contentReview, sha256: CONTENT01_ANCHORS.contentReview },
        { name: 'owner-approval', path: CONTENT01_INPUT_PATHS.approval, sha256: CONTENT01_ANCHORS.approval },
        { name: 'root-binding', path: CONTENT01_INPUT_PATHS.bindings, sha256: CONTENT01_ANCHORS.bindings },
        { name: 'settings-json', path: CONTENT01_INPUT_PATHS.settingsJson, sha256: CONTENT01_ANCHORS.settingsJson },
        { name: 'settings-markdown', path: CONTENT01_INPUT_PATHS.settingsMarkdown, sha256: CONTENT01_ANCHORS.settingsMarkdown },
      ],
    });
  }
  if (descriptors.length !== 12 || descriptors.reduce((count, pin) => count + pin.items.length, 0) !== 65) fail('CONTENT01_COUNT_MISMATCH');
  const pins = descriptors.map(({ hints, graphemes, hintRoot, effectValue, effectValueSource, proofHash, ...pin }) => pin);
  const approvedSettings: ApprovedListSettings = {
    categoryLabel: 'قوائم معرفية', modes: ['STANDALONE_LIST', 'MIXED_BOARD'], itemValue: 100,
    wrongAnswerDelta: 0, duplicateCredit: false, traps: false, standaloneTurnSeconds: 45,
    standaloneOverallSeconds: 300, embeddedSharedSeconds: 40, generalSuggestedAge: 12,
    advancedSuggestedAge: 16, ageRecommendationsPlaytested: false, textOnly: true,
    embeddedAids: ['PHONE_A_FRIEND', 'MORE_HINT', 'PICK_ANSWERER', 'STEAL_POINTS'],
    standaloneAids: ['HINT', 'PASS', 'FREEZE', 'DOUBLE', 'PHONE'], embeddedStealCap: 200,
    standaloneHintRequiresExternalGrapheme: true, orderIsHostAdjudicated: true,
    publicationAllowed: false, selectorEligible: false, R6: 'STOP',
  };
  const parents = [
    CONTENT01_ANCHORS.approval, CONTENT01_ANCHORS.bindings, CONTENT01_ANCHORS.contentReview,
    CONTENT01_ANCHORS.draft, CONTENT01_ANCHORS.expansion,
    CONTENT01_ANCHORS.settingsJson, CONTENT01_ANCHORS.settingsMarkdown,
  ];
  const revisionHash = hash({
    revisionId, parents, pins, descriptors, metadata, settings: approvedSettings,
    revisionConvention: 'R2 pack metadata successor; unchanged approved card/answer pin revisions retained',
  });
  const frozenMetadata = immutable(structuredClone(metadata));
  const frozenPins = immutable(structuredClone(pins));
  const frozenDescriptors = immutable(structuredClone(descriptors));
  const frozenSettings = immutable(structuredClone(approvedSettings));
  return {
    revisionId, revisionHash, categoryKey, settings: frozenSettings,
    pins: frozenPins, descriptors: frozenDescriptors, metadata: frozenMetadata,
    lookup(query) {
      if (query.revisionId !== revisionId || query.revisionHash !== revisionHash) return null;
      const record = frozenMetadata.find(entry => entry.cardId === query.cardId);
      if (!record || query.answerId !== undefined && !frozenPins.find(pin => pin.sourceId === query.cardId)?.items.some(item => item.id === query.answerId)) return null;
      return immutable(structuredClone(record));
    },
  };
}
