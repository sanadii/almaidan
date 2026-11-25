import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../src/app/ThemeProvider";
import type { ProjectionEnvelope, SafeProjection } from "../../src/features/game/runtime/contracts";

const runtime = vi.hoisted(() => ({
  kind: "firebase" as const,
  createRoom: vi.fn(),
  submitGameIntent: vi.fn(),
  subscribeProjection: vi.fn(),
}));

vi.mock("../../src/features/game/runtime", () => ({ gameRuntime: runtime }));

import { RoomRoute } from "../../src/routes/GameRoutes";

let projection: ProjectionEnvelope<SafeProjection>;

function RoomLocation() {
  return <output data-testid="room-location">{useLocation().pathname}</output>;
}
function hostProjection({
  state = "CELL_SELECTION",
  contentHold,
  endedWithoutWinner,
}: {
  state?: SafeProjection["room"]["state"];
  contentHold?: SafeProjection["contentHold"];
  endedWithoutWinner?: boolean;
} = {}): ProjectionEnvelope<SafeProjection> {
  return {
    roomId: "room-hold",
    revision: 7,
    role: "host",
    serverTime: new Date().toISOString(),
    projection: {
      room: {
        roomCode: "HOLD42",
        state,
        readyCount: 2,
        memberCount: 2,
        teams: { horizontal: "الأحمر", vertical: "الأخضر" },
        matchSettings: {
          demo: true,
          gameKind: "categories",
          modality: "classic",
          mode: "classic",
          questionSeconds: 20,
          opponentSeconds: 10,
          teams: { horizontal: "الأحمر", vertical: "الأخضر" },
          categories: ["tahadani-006", "tahadani-007"],
        },
      },
      board: [{ id: "cell-0-0", q: 0, r: 0, kind: "category", visibleValue: "فئة", categoryLabelAr: "من أنا / لاعبين كرة قدم", categoryOccurrence: 3 }],
      questionScores: { horizontal: 2, vertical: 1 },
      roundWins: { horizontal: 0, vertical: 0 },
      ...(contentHold ? { contentHold } : {}),
      ...(endedWithoutWinner ? { endedWithoutWinner: true } : {}),
    },
  };
}

function renderHost(surface: "host" | "results" = "host") {
  const path = `/room/HOLD42/${surface}`;
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <RoomLocation />
        <Routes>
          <Route path="/room/:roomCode/host" element={<RoomRoute surface="host" />} />
          <Route path="/room/:roomCode/results" element={<RoomRoute surface="results" />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}
function renderDisplay() {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={["/room/HOLD42/display"]}>
        <Routes>
          <Route path="/room/:roomCode/display" element={<RoomRoute surface="display" />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  projection = hostProjection();
  sessionStorage.setItem("huroof:code:HOLD42", "room-hold");
  sessionStorage.setItem("huroof:room-hold", JSON.stringify({ token: "", role: "host" }));
  runtime.submitGameIntent.mockReset();
  runtime.submitGameIntent.mockResolvedValue({ revision: 8, replayed: false });
  runtime.createRoom.mockReset();
  runtime.createRoom.mockResolvedValue({ roomId: "rematch", roomCode: "REMATCH", token: "" });
  runtime.subscribeProjection.mockReset();
  runtime.subscribeProjection.mockImplementation((_roomId: string, _role: string, _uid: string, onProjection: (value: typeof projection) => void) => {
    onProjection(projection);
    return () => undefined;
  });
});

afterEach(cleanup);

describe("RoomRoute held and incomplete game surfaces", () => {
  it("makes an exhausted selection an end-only host state instead of a playable board", async () => {
    projection = hostProjection({ contentHold: { reason: "CONTENT_EXHAUSTED", operation: "SELECT_CELL", cellId: "cell-0-0" } });
    renderHost();

    expect(await screen.findByText(/توقف اختيار المحتوى/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "اختر حرفًا من اللوحة" })).not.toBeInTheDocument();
    expect(document.querySelectorAll(".game-board__button")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "إيقاف مؤقت" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("إظهار السؤال على شاشة العرض")).toBeDisabled();
    expect(screen.getByText(/خيارات العرض المشتركة معلقة/)).toBeVisible();
    fireEvent.click(screen.getByTestId("correction-trigger"));
    expect(await screen.findByText(/سجل التدقيق متاح للقراءة فقط/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "معاينة التصحيح" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "إنهاء المباراة كاملةً بلا فائز" }));
    fireEvent.click(screen.getByRole("button", { name: "إنهاء المباراة كاملةً" }));
    await waitFor(() => expect(runtime.submitGameIntent).toHaveBeenCalledTimes(1));
    expect(runtime.submitGameIntent.mock.calls[0][1]).toMatchObject({ type: "END_WITHOUT_WINNER" });
  });

  it("opens a modal enlarged category board, then restores trigger focus after Escape", async () => {
    renderHost();

    const trigger = await screen.findByTestId("expand-category-board");
    fireEvent.click(trigger);
    const dialog = screen.getByTestId("expanded-category-board");
    expect(dialog).toHaveAttribute("open");
    expect(screen.getByRole("heading", { name: "لوحة الفئات المكبرة" })).toBeVisible();
    expect(dialog.querySelectorAll('[data-testid="cell-0-0"]')).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "إغلاق اللوحة المكبرة" })).toHaveFocus());
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(screen.getByTestId("expanded-category-board")).not.toHaveAttribute("open");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("shows an honest incomplete result and creates a fresh same-settings rematch", async () => {
    projection = hostProjection({ state: "MATCH_COMPLETE", endedWithoutWinner: true });
    renderHost("results");

    expect(await screen.findByRole("heading", { name: "انتهت المباراة بلا فائز" })).toBeVisible();
    expect(screen.queryByText(/نفد المحتوى المتاح/)).not.toBeInTheDocument();
    expect(screen.getByText(/احتُفظ بالنقاط وسجل الجولات دون إعلان فائز/)).toBeVisible();
    expect(screen.getByRole("link", { name: "غيّروا اللعبة" })).toHaveAttribute("href", "/#game-choice-title");
    expect(screen.getByTestId("rematch-same-settings")).toHaveAccessibleName("العبوا مرة ثانية");
    fireEvent.click(screen.getByTestId("rematch-same-settings"));
    await waitFor(() => expect(runtime.createRoom).toHaveBeenCalledWith(expect.objectContaining({
      gameKind: "categories",
      categories: ["tahadani-006", "tahadani-007"],
    })));
  });

  it.each([
    { endedWithoutWinner: true, heading: "انتهت المباراة بلا فائز" },
    { endedWithoutWinner: false, heading: "فاز فريق الأحمر" },
  ])("gives the audience the correct match result ($heading)", async ({ endedWithoutWinner, heading }) => {
    const base = hostProjection({ state: "MATCH_COMPLETE", endedWithoutWinner });
    projection = {
      ...base,
      role: "audience",
      projection: {
        ...base.projection,
        room: { ...base.projection.room, audienceQuestionVisible: false },
        ...(endedWithoutWinner ? {} : { matchWinner: "horizontal" }),
      },
    };
    sessionStorage.setItem("huroof:room-hold:audience", JSON.stringify({ token: "", role: "audience" }));
    renderDisplay();

    expect(await screen.findByRole("heading", { name: heading })).toBeVisible();
    const completedPath = screen.queryByText("اكتمل المسار والمباراة");
    if (endedWithoutWinner) expect(completedPath).not.toBeInTheDocument();
    else expect(completedPath).toBeVisible();
  });

  it("uses shared arrow icons and names both teams and round winners", async () => {
    projection = hostProjection({ state: "MATCH_COMPLETE" });
    projection.projection.roundResults = [{ round: 1, winner: "horizontal" }, { round: 2, winner: "vertical" }];
    renderHost("results");

    const scoreCards = (await screen.findByText("الأحمر", { selector: "h2 bdi" })).closest(".huroof-results__scores")! as HTMLElement;
    const red = within(scoreCards).getByRole("heading", { name: "الأحمر" });
    const green = within(scoreCards).getByRole("heading", { name: "الأخضر" });
    expect(red.querySelector("svg")).toHaveAttribute("stroke", "currentColor");
    expect(green.querySelector("svg")).toHaveAttribute("stroke", "currentColor");
    expect(red.querySelector("path")?.getAttribute("d")).not.toBe(green.querySelector("path")?.getAttribute("d"));
    expect(red.parentElement).toHaveTextContent("2 نقاط الإجابات");
    expect(green.parentElement).toHaveTextContent("1 نقاط الإجابات");
    const summary = screen.getByText("قواعد احتساب النقاط");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(summary);
    const rounds = within(screen.getByRole("list", { name: "نتائج الجولات" })).getAllByRole("listitem");
    expect(rounds[0]).toHaveTextContent("الجولة 1 · الأحمر");
    expect(rounds[1]).toHaveTextContent("الجولة 2 · الأخضر");
  });

  it("sends the completed host to their result, announces the winner and offers a rematch", async () => {
    projection = hostProjection({ state: "MATCH_COMPLETE" });
    projection.projection.matchWinner = "horizontal";
    renderHost();

    expect(await screen.findByRole("heading", { name: "فاز فريق الأحمر" })).toHaveFocus();
    expect(screen.getByTestId("room-location")).toHaveTextContent("/room/HOLD42/results");
    expect(screen.queryByText("بانتظار السؤال")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "العبوا مرة ثانية" })).toBeVisible();
  });

  it("keeps a retained final challenge review available until the host continues", async () => {
    projection = hostProjection({ state: "MATCH_COMPLETE" });
    projection.projection.matchWinner = "horizontal";
    projection.projection.challenge = {
      protocolVersion: "t36-challenge-runtime-v1", kind: "missing_tile", recipient: "host", occurrence: "last-challenge", revision: 5,
      assignmentGeneration: 1, disclosureGeneration: 2, stage: "result", paused: false, strikes: 0,
      entitledTeam: "horizontal", answeringTeam: "horizontal",
      readiness: { protocolHash: "p", assignmentHash: "a", stimulusHash: "s", required: false, acknowledged: true },
      legalActions: ["CONTINUE"], timing: { countdownSeconds: 3, answerSeconds: 30 }, assignments: {}, attemptsClosed: true, solutionRevealed: false,
    };
    let publish!: (value: ProjectionEnvelope<SafeProjection>) => void;
    runtime.subscribeProjection.mockImplementation((_room, _role, _uid, next) => { publish = next; next(projection); return () => undefined; });
    renderHost();
    expect(await screen.findByTestId("challenge-stage")).toBeVisible();
    expect(screen.getByTestId("room-location")).toHaveTextContent("/room/HOLD42/host");
    const next = { ...projection, revision: 8, projection: { ...projection.projection, challenge: undefined } };
    projection = next;
    act(() => publish(next));
    expect(await screen.findByRole("heading", { name: "فاز فريق الأحمر" })).toBeVisible();
  });

  it("moves focus with room state to the primary host action and question heading", async () => {
    const failed = hostProjection({ state: "QUESTION_FAILED" });
    let publish!: (value: ProjectionEnvelope<SafeProjection>) => void;
    runtime.subscribeProjection.mockImplementation((_roomId: string, _role: string, _uid: string, onProjection: (value: ProjectionEnvelope<SafeProjection>) => void) => {
      publish = onProjection;
      onProjection(failed);
      return () => undefined;
    });
    renderHost();
    expect(await screen.findByRole("button", { name: /كمّلوا/ })).toHaveFocus();

    act(() => {
      publish({
        ...failed,
        revision: failed.revision + 1,
        projection: {
          ...failed.projection,
          room: { ...failed.projection.room, state: "CELL_SELECTION" },
        },
      });
    });
    const next = await screen.findByRole("button", { name: "اختر فئة من اللوحة" });
    expect(next).toHaveFocus();
    fireEvent.click(next);
    expect(screen.getByRole("button", { name: /من أنا/ })).toHaveFocus();
    act(() => publish({ ...failed, revision: 9, projection: { ...failed.projection, room: { ...failed.projection.room, state: "PAUSED" } } }));
    expect(screen.getByRole("heading", { name: "سؤال الجولة" })).toHaveFocus();
  });

  it("prepares a legacy round automatically if it is delivered in round setup", async () => {
    projection = hostProjection({ state: "ROUND_SETUP" });
    renderHost();
    await waitFor(() => expect(runtime.submitGameIntent).toHaveBeenCalledWith("room-hold", expect.objectContaining({ type: "ROUND_READY", expectedRevision: 7 })));
    expect(screen.queryByRole("button", { name: "جهّز الجولة" })).not.toBeInTheDocument();
  });

  it("offers round preparation recovery only after the automatic request fails", async () => {
    projection = hostProjection({ state: "ROUND_SETUP" });
    runtime.submitGameIntent.mockRejectedValueOnce(new Error("تعذّر تجهيز الجولة"));
    renderHost();
    const retry = await screen.findByRole("button", { name: "أعد تجهيز الجولة" });
    fireEvent.click(retry);
    await waitFor(() => expect(runtime.submitGameIntent).toHaveBeenCalledTimes(2));
    expect(runtime.submitGameIntent.mock.calls[1][1]).toMatchObject({ type: "ROUND_READY", expectedRevision: 7 });
  });

  it("shows the post-award chooser on host and display, and the display reading timer when question text is hidden", async () => {
    projection.projection.entitledTeam = "horizontal";
    const host = renderHost();
    expect(await screen.findByText("فريق الأحمر يختار الفئة التالية")).toBeVisible();
    host.unmount();
    sessionStorage.setItem("huroof:room-hold:audience", JSON.stringify({ token: "", role: "audience" }));
    projection.role = "audience";
    const display = renderDisplay();
    expect(await screen.findByText("فريق الأحمر يختار الفئة التالية")).toBeVisible();
    display.unmount();
    projection.projection.room.state = "QUESTION_READING";
    projection.projection.room.audienceQuestionVisible = false;
    projection.projection.deadlineAt = new Date(Date.parse(projection.serverTime) + 20_000).toISOString();
    renderDisplay();
    expect(await screen.findByRole("timer", { name: "الوقت المتبقي" })).toHaveTextContent("00:20");
  });
  it("ignores a delayed completed-room projection while a same-route rematch lobby loads", async () => {
    const callbacks = new Map<string, (value: ProjectionEnvelope<SafeProjection>) => void>();
    const old = { ...hostProjection({ state: "LOBBY" }), roomId: "room-old", revision: 4 };
    runtime.subscribeProjection.mockImplementation((roomId: string, _role: string, _uid: string, onProjection: (value: ProjectionEnvelope<SafeProjection>) => void) => {
      callbacks.set(roomId, onProjection);
      if (roomId === "room-old") onProjection(old);
      return () => undefined;
    });
    sessionStorage.setItem("huroof:code:OLD", "room-old");
    sessionStorage.setItem("huroof:room-old", JSON.stringify({ token: "", role: "host" }));
    sessionStorage.setItem("huroof:code:NEW", "room-new");
    sessionStorage.setItem("huroof:room-new", JSON.stringify({ token: "", role: "host" }));
    render(<ThemeProvider><MemoryRouter initialEntries={["/room/OLD/lobby"]}><RoomLocation /><Link to="/room/NEW/lobby">انتقل للإعادة</Link><Routes><Route path="/room/:roomCode/lobby" element={<RoomRoute surface="lobby" />} /><Route path="/room/:roomCode/host" element={<RoomRoute surface="host" />} /></Routes></MemoryRouter></ThemeProvider>);
    await waitFor(() => expect(callbacks.has("room-old")).toBe(true));
    fireEvent.click(screen.getByRole("link", { name: "انتقل للإعادة" }));
    await waitFor(() => expect(callbacks.has("room-new")).toBe(true));
    callbacks.get("room-old")!({ ...old, revision: 99, projection: { ...old.projection, room: { ...old.projection.room, state: "ROUND_SETUP" } } });
    expect(screen.getByTestId("room-location")).toHaveTextContent("/room/NEW/lobby");
    expect(runtime.submitGameIntent).not.toHaveBeenCalled();
  });

  it("renders a restored failed display prompt immediately instead of leaving an empty reveal", async () => {
    const base = hostProjection({ state: "QUESTION_FAILED" });
    projection = {
      ...base,
      role: "audience",
      projection: {
        ...base.projection,
        room: { ...base.projection.room, audienceQuestionVisible: true },
        question: { headerAr: "فئة", promptAr: "السؤال المستعاد", revealedAnswer: "الإجابة" },
      },
    };
    sessionStorage.setItem("huroof:room-hold:audience", JSON.stringify({ token: "", role: "audience" }));
    renderDisplay();
    expect(await screen.findByRole("heading", { name: "السؤال المستعاد" })).toBeVisible();
    expect(screen.getByTestId("shared-revealed-answer")).toHaveTextContent("الإجابة");
  });
});


