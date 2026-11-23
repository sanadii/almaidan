import { randomUUID } from 'node:crypto';

export type StudyQuestion = { id: string; revision: string; prompt: string; choices: string[]; correctIndex: number };
/** The supplier must qualify review and sealing before returning a pool. */
export type StudyPool = { releaseId: string; seal: string; questions: StudyQuestion[] };
type PinnedQuestion = { id: string; sourceId: string; revision: string; prompt: string; choices: { id: string; text: string }[]; correctChoiceId: string };
type Answer = { choiceId: string; correct: boolean; receipt: StudyView & { correct: boolean } };
export type StudyView = { sessionId: string; progress: { answered: number; total: number }; question: null | { id: string; prompt: string; choices: { id: string; text: string }[] } }; 
export type StudySession = { id: string; owner: string; releaseId: string; seal: string; questions: PinnedQuestion[]; answers: Record<string, Answer> };
/** Implementations must serialize mutations for each session and commit them atomically. */
export interface StudyRepository {
  /** Atomically lookup owner/request receipt before invoking create, then commit session and receipt together. */
  start(owner: string, requestId: string, create: () => Promise<{ session: StudySession; receipt: StudyView }>): Promise<StudyView>;
  transact<T>(id: string, owner: string, operation: (session: StudySession) => T): Promise<T | undefined>;
}
export class StudyError extends Error { constructor(public readonly code: 'UNAVAILABLE' | 'NOT_FOUND' | 'TOO_EARLY' | 'INVALID_CHOICE' | 'CONFLICT') { super(code); } }
const MAX_QUESTIONS = 50;
const validText = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\p{Cc}\p{Cf}]/u.test(value);
function pin(pool: StudyPool): PinnedQuestion[] {
  if (!validText(pool.releaseId, 200) || !validText(pool.seal, 200) || !Array.isArray(pool.questions) || pool.questions.length < 1 || pool.questions.length > MAX_QUESTIONS) throw new StudyError('UNAVAILABLE');
  const ids = new Set<string>();
  return pool.questions.map(q => {
    if (!validText(q.id, 200) || ids.has(q.id) || !validText(q.revision, 200) || !validText(q.prompt, 4000) || !Array.isArray(q.choices) || q.choices.length < 2 || q.choices.length > 6 || q.choices.some(c => !validText(c, 1000)) || new Set(q.choices.map(c => c.normalize('NFKC').trim())).size !== q.choices.length || !Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.choices.length) throw new StudyError('UNAVAILABLE');
    ids.add(q.id);
    const choices = q.choices.map(text => ({ id: randomUUID(), text }));
    return { id: randomUUID(), sourceId: q.id, revision: q.revision, prompt: q.prompt, choices, correctChoiceId: choices[q.correctIndex].id };
  });
}
function view(s: StudySession): StudyView {
  const index = s.questions.findIndex(q => !s.answers[q.id]);
  const question = index < 0 ? null : s.questions[index];
  return { sessionId: s.id, progress: { answered: Object.keys(s.answers).length, total: s.questions.length }, question: question ? { id: question.id, prompt: question.prompt, choices: question.choices.map(c => ({ ...c })) } : null };
}
export function createStudyService(repository: StudyRepository, reviewedPool?: () => Promise<StudyPool | null>) {
  async function owned<T>(owner: string, id: string, fn: (s: StudySession) => T): Promise<T> {
    const result = await repository.transact(id, owner, s => { if (s.owner !== owner) throw new StudyError('NOT_FOUND'); return fn(s); }); if (result === undefined) throw new StudyError('NOT_FOUND'); return result;
  }
  return {
    async start(owner: string, requestId: string) {
      if (!owner || !/^[a-f0-9-]{36}$/i.test(requestId)) throw new StudyError('UNAVAILABLE');
      return repository.start(owner, requestId, async () => {
        if (!reviewedPool) throw new StudyError('UNAVAILABLE');
        const pool = await reviewedPool(); if (!pool) throw new StudyError('UNAVAILABLE');
        const session: StudySession = { id: randomUUID(), owner, releaseId: pool.releaseId, seal: pool.seal, questions: pin(pool), answers: {} };
        return { session, receipt: view(session) };
      });
    },
    get(owner: string, id: string) { return owned(owner, id, view); },
    answer(owner: string, id: string, questionId: string, choiceId: string) {
      return owned(owner, id, s => {
        const index = s.questions.findIndex(q => q.id === questionId); if (index < 0) throw new StudyError('NOT_FOUND');
        const question = s.questions[index]; const prior = s.answers[questionId];
        if (prior) { if (prior.choiceId !== choiceId) throw new StudyError('CONFLICT'); return structuredClone(prior.receipt); }
        if (s.questions.findIndex(q => !s.answers[q.id]) !== index) throw new StudyError('TOO_EARLY');
        if (!question.choices.some(c => c.id === choiceId)) throw new StudyError('INVALID_CHOICE');
        const correct = choiceId === question.correctChoiceId; s.answers[questionId] = { choiceId, correct, receipt: undefined as never };
        const receipt = { correct, ...view(s) }; s.answers[questionId].receipt = structuredClone(receipt);
        return receipt;
      });
    },
  };
}
export type StudyService = ReturnType<typeof createStudyService>;
