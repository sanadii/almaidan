import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../src/app/ThemeProvider";
import type { ProjectionEnvelope, SafeProjection } from "../../src/features/game/runtime/contracts";

const runtime = vi.hoisted(() => ({
  kind: "firebase" as const,
  submitGameIntent: vi.fn(),
  subscribeProjection: vi.fn(),
}));

vi.mock("../../src/features/game/runtime", () => ({ gameRuntime: runtime }));

import { RoomRoute } from "../../src/routes/GameRoutes";

let projection: ProjectionEnvelope<SafeProjection>;
let publish: (value: ProjectionEnvelope<SafeProjection>) => void;

function playerProjection({
  state = "QUESTION_READING",
  team = "vertical",
  canBuzz = true,
}: {
  state?: SafeProjection["room"]["state"];
  team?: "horizontal" | "vertical";
  canBuzz?: boolean;
} = {}): ProjectionEnvelope<SafeProjection> {
  return {
    roomId: "room-1",
    revision: 1,
    role: "player",
    serverTime: new Date().toISOString(),
    projection: {
      room: {
        roomCode: "BUZZER",
        state,
        readyCount: 2,
        memberCount: 2,
        teams: { horizontal: "الأحمر", vertical: "الأخضر" },
      },
      self: { uid: "player-1", displayName: "نور", ready: true, team, canBuzz },
    },
  };
}

function renderPlayer() {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={["/room/BUZZER/play"]}>
        <Routes>
          <Route path="/room/:roomCode/play" element={<RoomRoute surface="play" />} />
          <Route path="/room/:roomCode/results" element={<RoomRoute surface="results" />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  projection = playerProjection();
  sessionStorage.setItem("huroof:code:BUZZER", "room-1");
  sessionStorage.setItem("huroof:room-1", JSON.stringify({ token: "", role: "player" }));
  runtime.submitGameIntent.mockReset();
  runtime.subscribeProjection.mockReset();
  runtime.subscribeProjection.mockImplementation(
    (_roomId: string, _role: string, _uid: string, onProjection: typeof publish) => {
      publish = onProjection;
      onProjection(projection);
      return () => undefined;
    },
  );
});

describe("RoomRoute player buzzer", () => {
  it("uses the joined team surface and sends one pending buzz from the keyboard", async () => {
    const user = userEvent.setup();
    let resolveIntent: () => void = () => undefined;
    runtime.submitGameIntent.mockImplementation(
      () => new Promise<void>((resolve) => { resolveIntent = resolve; }),
    );
    renderPlayer();

    const buzzer = await screen.findByRole("button", { name: "اضغط الآن" });
    expect(screen.getByRole("main")).toHaveClass("player-page--vertical");
    expect(screen.getByRole("main")).toHaveAttribute("data-team", "vertical");
    buzzer.focus();
    await user.keyboard("{Enter}");

    expect(runtime.submitGameIntent).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "جارٍ إرسال الضغط" })).toBeDisabled();
    expect(screen.getByRole("main")).toHaveAttribute("data-buzzer-state", "pending");
    await user.keyboard("{Enter}");
    expect(runtime.submitGameIntent).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveIntent();
      publish({
        ...projection,
        revision: 2,
        projection: {
          ...projection.projection,
          self: { ...projection.projection.self!, canBuzz: false },
        },
      });
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "استعد" })).toBeDisabled());
  });

  it("shows an Arabic send error and allows a keyboard retry", async () => {
    const user = userEvent.setup();
    runtime.submitGameIntent
      .mockRejectedValueOnce(new Error("تعذر إرسال الضغط."))
      .mockResolvedValueOnce(undefined);
    renderPlayer();

    const buzzer = await screen.findByRole("button", { name: "اضغط الآن" });
    buzzer.focus();
    await user.keyboard(" ");
    expect(await screen.findByText("تعذر إرسال الضغط.")).toBeVisible();
    const retry = screen.getByRole("button", { name: "اضغط الآن" });
    expect(retry).toBeEnabled();
    retry.focus();
    await user.keyboard("{Enter}");
    expect(runtime.submitGameIntent).toHaveBeenCalledTimes(2);
  });

  it("keeps the buzzer disabled until a cached Firebase snapshot is confirmed by the server", async () => {
    projection = { ...playerProjection(), authoritative: false };
    renderPlayer();

    expect(await screen.findByRole("button", { name: "بانتظار تأكيد الخادم" })).toBeDisabled();
    expect(screen.getByText("وصلت نسخة محفوظة. ننتظر تأكيد الخادم قبل فتح البازر.")).toBeVisible();
    expect(screen.getByRole("main")).toHaveAttribute("data-buzzer-state", "stale");

    await act(async () => publish({ ...projection, authoritative: true, revision: 2 }));
    expect(await screen.findByRole("button", { name: "اضغط الآن" })).toBeEnabled();
  });

  it("locks the offline buzzer and sends a completed player to the results with only the home action", async () => {
    const play = renderPlayer();
    await screen.findByRole("button", { name: "اضغط الآن" });

    await act(async () => window.dispatchEvent(new Event("offline")));
    expect(await screen.findByRole("button", { name: "انقطع الاتصال" })).toBeDisabled();
    play.unmount();
    projection = playerProjection({ state: "MATCH_COMPLETE", canBuzz: false });
    projection.projection.matchWinner = "vertical";
    renderPlayer();
    expect(await screen.findByRole("heading", { name: "فاز فريق الأخضر" })).toBeVisible();
    const actions = within(screen.getByRole("navigation", { name: "خيارات بعد المباراة" }));
    expect(actions.getAllByRole("link")).toHaveLength(1);
    expect(actions.getByRole("link", { name: "الرئيسية" })).toHaveAttribute("href", "/");
    expect(actions.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the round score, name, timer and guide on a phone during the reading phase", async () => {
    projection.projection.deadlineAt = new Date(Date.parse(projection.serverTime) + 20_000).toISOString();
    projection.projection.questionScores = { horizontal: 8, vertical: 6 };
    projection.projection.board = [{ id: "cell", q: 0, r: 0, kind: "letter", visibleValue: "أ", owner: "vertical" }];
    renderPlayer();
    expect(await screen.findByRole("timer", { name: "الوقت المتبقي" })).toHaveTextContent("00:20");
    expect(screen.getByText("نور").tagName).toBe("BDI");
    expect(screen.getByText(/نتيجة الجولة/)).toHaveTextContent("0 – 1");
    const guide = screen.getByRole("link", { name: "كيف نلعب؟" });
    expect(guide).toHaveAttribute("target", "_blank");
    expect(guide).toHaveAttribute("href", "/how-to-play#rules-khaliah");
  });

  it("names the buzzer winner during the answer and announces both judgments for three seconds", () => {
    vi.useFakeTimers();
    try {
      projection = playerProjection({ state: "FIRST_ANSWER", canBuzz: false });
      projection.projection.buzzWinner = { displayName: "Salem", team: "horizontal", method: "player" };
      const view = renderPlayer();
      expect(screen.getByText("Salem").tagName).toBe("BDI");
      expect(screen.getByText(/أسرع — ننتظر الإجابة/)).toHaveTextContent("Salem أسرع — ننتظر الإجابة");

      const wrong = playerProjection({ state: "OPPONENT_CHANCE", canBuzz: true });
      wrong.revision = 2;
      wrong.projection.answerFeedback = { outcome: "incorrect", expiresAt: new Date(Date.parse(wrong.serverTime) + 3_000).toISOString() };
      act(() => publish(wrong));
      expect(screen.getByText("إجابة خاطئة — الفرصة للفريق الآخر")).toBeVisible();
      act(() => vi.advanceTimersByTime(2_999));
      expect(screen.getByText("إجابة خاطئة — الفرصة للفريق الآخر")).toBeVisible();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByText("إجابة خاطئة — الفرصة للفريق الآخر")).not.toBeInTheDocument();

      const correct = playerProjection({ state: "CELL_SELECTION", canBuzz: false });
      correct.revision = 3;
      correct.projection.self!.isBuzzWinner = true;
      correct.projection.answerFeedback = { outcome: "correct", team: "vertical", expiresAt: new Date(Date.parse(correct.serverTime) + 3_000).toISOString() };
      act(() => publish(correct));
      expect(screen.queryByText("أنت الأسرع — أجب الآن")).not.toBeInTheDocument();
      expect(screen.getByText("إجابة صحيحة — الخلية لفريق الأخضر")).toBeVisible();
      act(() => vi.advanceTimersByTime(3_000));
      expect(screen.queryByText(/إجابة صحيحة/)).not.toBeInTheDocument();
      view.unmount();
    } finally { vi.useRealTimers(); }
  });
});
