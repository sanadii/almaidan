import { fail, type EntaMode, type MatchProjection, type MatchRecord } from "./types";
import { cleanAnswerText } from "../utils/answer-text";

export function storedMatchMode(game: MatchRecord): EntaMode {
  if (game.mode === "CLASSIC" && (game.setup.version === 2 || game.setup.version === 3) && game.categories.length === 6 && game.questions.length === 36) return "CLASSIC";
  if (game.mode === "KIDS" && game.setup.version === 3 && game.categories.length === 1 && game.questions.length === 6) return "KIDS";
  // Only affirmative accepted v2 CLASSIC evidence permits compatibility.
  if (game.mode === undefined && game.setup.version === 2 && game.categories.length === 6 && game.questions.length === 36) return "CLASSIC";
  return fail(503, "MATCH_DATA_UNAVAILABLE");
}

/** Explicit projection; board, results and receipts never carry grading DTOs. */
export function projectMatch(game: MatchRecord, serverNow: number): MatchProjection {
  if (game.teams.length < 2 || !Number.isFinite(serverNow)) return fail(503, "MATCH_DATA_UNAVAILABLE");
  const active = game.phase === "QUESTION_OPEN" || game.phase === "REVEALED";
  const question = active ? game.questions.find(question => question.id === game.activeQuestionId) : undefined;
  if (active && (!question || !game.activeTeamId || game.deadlineAt === null)) return fail(503, "MATCH_DATA_UNAVAILABLE");
  const currentQuestion = question ? {
    id: question.id, prompt: question.prompt, points: question.points, answeringTeamId: game.activeTeamId!, deadlineAt: game.deadlineAt!,
    // Matches pinned before display cleaning still hold raw saved-source text; clean it on the way out.
    ...(game.phase === "REVEALED" ? { answers: question.answers.filter(answer => answer.isCorrect && !answer.isTrap).map(answer => cleanAnswerText(answer.text)) } : {}),
  } : null;
  const highest = Math.max(...game.teams.map(team => team.score));
  const winners = game.teams.filter(team => team.score === highest).map(team => team.id);
  return {
    id: game.id, mode: storedMatchMode(game), version: game.version, phase: game.phase, serverNow,
    rules: { questionSeconds: game.setup.rules.questionSeconds },
    teams: game.teams.map(team => ({ id: team.id, name: team.name, players: [...team.players], score: team.score })),
    categories: game.categories.map(category => ({ key: category.key, label: category.label })),
    tiles: game.questions.map(question => ({ id: question.id, categoryKey: question.categoryKey, points: question.points, used: question.isCorrect !== null, active: active && question.id === game.activeQuestionId, answeredByTeamId: question.answeredByTeamId, isCorrect: question.isCorrect })),
    turnTeamId: game.teams[game.turnIndex % game.teams.length].id,
    currentQuestion,
    result: game.phase === "FINISHED" ? { reason: game.resultReason!, unplayedCount: game.unplayedCount, winnerTeamIds: winners, isTie: winners.length > 1 } : null,
  };
}
