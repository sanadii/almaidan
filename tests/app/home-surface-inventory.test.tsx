import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { ThemeProvider } from "../../src/app/ThemeProvider";
import { FirebaseAuthContext, loadingAuthContext } from "../../src/features/auth/auth-context";
import { HomeSurface } from "../../src/routes/HomeSurface";

vi.mock("../../src/features/game/runtime", () => ({
  gameRuntime: { kind: "local" },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("uses only local categories eligible for the category board", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        source: "local_sqlite_import",
        huroofAvailable: true,
        categories: [
          {
            id: "tahadani-ready",
            labelAr: "فئة جاهزة",
            sourceOnly: true,
            questionCount: 14,
            heldQuestionCount: 0,
            huroofQuestionCount: 14,
            categoryGameEligible: true,
            availability: "ready",
          },
          {
            id: "tahadani-held",
            labelAr: "فئة مؤجلة",
            sourceOnly: true,
            questionCount: 0,
            heldQuestionCount: 6,
            huroofQuestionCount: 0,
            categoryGameEligible: false,
            availability: "held_only",
          },
        ],
      }),
    ),
  );
  render(
    <ThemeProvider>
      <MemoryRouter>
        <HomeSurface joinForm={<form />} joinMessage={null} />
      </MemoryRouter>
    </ThemeProvider>,
  );
  expect(await screen.findByRole("link", { name: /فئة جاهزة/ })).toHaveAttribute(
    "href",
    "/host/new?kind=categories&category=tahadani-ready",
  );
  expect(screen.queryByRole("link", { name: /فئة مؤجلة/ })).not.toBeInTheDocument();
  expect(screen.queryByText("فئة مؤجلة")).not.toBeInTheDocument();
});

it("shows no invented categories in static preview and disables hosting even for a verified account", async () => {
  vi.stubEnv("VITE_STATIC_PREVIEW", "true");
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const verifiedUser = { isAnonymous: false, emailVerified: true, providerData: [{ providerId: "google.com" }] } as never;
  render(
    <ThemeProvider>
      <MemoryRouter>
        <FirebaseAuthContext.Provider value={{ ...loadingAuthContext, status: "google", user: verifiedUser }}>
          <HomeSurface joinForm={<form />} joinMessage={null} staticPreview />
        </FirebaseAuthContext.Provider>
      </MemoryRouter>
    </ThemeProvider>,
  );

  expect(screen.getByText("معاينة الواجهة لا تحتوي على فئات لعب منشورة.")).toBeVisible();
  expect(screen.queryByRole("searchbox", { name: "تصفية الفئات" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "الاستضافة غير متاحة" })).toBeDisabled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("settles a disabled local inventory as unavailable instead of waiting forever", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
    JSON.stringify({ error: "LOCAL_DB_SOURCE_DISABLED" }),
    { status: 400, headers: { "content-type": "application/json" } },
  ));
  render(<ThemeProvider><MemoryRouter><HomeSurface joinForm={<form />} joinMessage={null} /></MemoryRouter></ThemeProvider>);

  expect(await screen.findByText("فهرس الفئات المحلي غير متاح حالياً.")).toBeVisible();
  expect(screen.queryByText("جارٍ التحقق من الفئات المتاحة…")).not.toBeInTheDocument();
  expect(screen.queryByText("لا توجد فئات جاهزة للعرض حالياً.")).not.toBeInTheDocument();
});

it("offers recovery after a local inventory request fails", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch")
    .mockRejectedValueOnce(new Error("LOCAL_INVENTORY_UNAVAILABLE"))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      source: "local_sqlite_import",
      huroofAvailable: true,
      categories: [{
        id: "tahadani-ready", labelAr: "فئة جاهزة", sourceOnly: true,
        questionCount: 14, heldQuestionCount: 0, huroofQuestionCount: 14,
        categoryGameEligible: true, availability: "ready",
      }],
    })));
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HomeSurface joinForm={<form />} joinMessage={null} /></MemoryRouter></ThemeProvider>);

  await user.click(await screen.findByRole("button", { name: "أعد المحاولة" }));
  expect(await screen.findByRole("link", { name: /فئة جاهزة/ })).toHaveAttribute(
    "href",
    "/host/new?kind=categories&category=tahadani-ready",
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("shows clearly marked non-playable catalogue previews when the local service is unavailable", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
  render(<ThemeProvider><MemoryRouter><HomeSurface joinForm={<form />} joinMessage={null} /></MemoryRouter></ThemeProvider>);
  expect(await screen.findByText(/لا يمكن التحقق من جاهزيتها للعب الآن/)).toBeVisible();
  expect(screen.getAllByText("للمعاينة فقط").length).toBeGreaterThan(0);
  expect(screen.queryByRole("link", { name: /من سجل الهدف/ })).not.toBeInTheDocument();
});

it("requires a verified account before showing the Huroof host action", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    source: "local_sqlite_import",
    huroofAvailable: false,
    categories: [],
  })));
  const unverifiedGoogleUser = { isAnonymous: false, emailVerified: false, providerData: [{ providerId: "google.com" }] } as never;
  render(
    <ThemeProvider>
      <MemoryRouter>
        <FirebaseAuthContext.Provider value={{ ...loadingAuthContext, status: "google", user: unverifiedGoogleUser }}>
          <HomeSurface joinForm={<form />} joinMessage={null} />
        </FirebaseAuthContext.Provider>
      </MemoryRouter>
    </ThemeProvider>,
  );

  await screen.findByText("لا توجد فئات جاهزة للعرض حالياً.");
  expect(screen.getByRole("link", { name: "تسجيل الدخول للاستضافة" })).toHaveAttribute("href", "/login?returnTo=%2Fhost%2Fnew%3Fkind%3Dhuroof");
  expect(screen.queryByRole("link", { name: "إنشاء مباراة" })).not.toBeInTheDocument();
});

it("keeps the real verified host route, guest join path, and unavailable Enta state distinct", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    source: "local_sqlite_import",
    huroofAvailable: true,
    categories: [],
  })));
  const verifiedUser = { isAnonymous: false, emailVerified: true, providerData: [{ providerId: "google.com" }] } as never;
  render(
    <ThemeProvider>
      <MemoryRouter>
        <FirebaseAuthContext.Provider value={{ ...loadingAuthContext, status: "google", user: verifiedUser }}>
          <HomeSurface joinForm={<form><label htmlFor="room-code-test">رمز الغرفة</label><input id="room-code-test" /></form>} joinMessage={null} />
        </FirebaseAuthContext.Provider>
      </MemoryRouter>
    </ThemeProvider>,
  );

  await screen.findByText("لا توجد فئات جاهزة للعرض حالياً.");
  expect(screen.getByRole("heading", { name: "أحلى جمعة تبدأ بلعبة. واللعبة تحلى بأصحابكم. في الميدان." })).toBeVisible();
  expect(screen.getByRole("link", { name: "الحساب" })).toHaveAttribute("href", "/account");
  expect(screen.getByTestId("huroof-honeycomb").children).toHaveLength(25);
  expect(screen.getByRole("link", { name: "إنشاء مباراة" })).toHaveAttribute("href", "/host/new?kind=huroof");
  expect(screen.getByLabelText("رمز الغرفة")).toBeVisible();
  expect(screen.getByText(/الانضمام متاح للضيف/)).toBeVisible();
  expect(screen.getByText("إنت صح — قريباً")).toBeVisible();
  expect(within(document.querySelector('[data-home-region="game-choice"]')!).queryByRole("link", { name: /إنت صح/ })).not.toBeInTheDocument();
});

it("shows search recovery when no eligible category matches the query", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    source: "local_sqlite_import",
    huroofAvailable: true,
    categories: [{
      id: "tahadani-ready", labelAr: "فئة جاهزة", sourceOnly: true,
      questionCount: 14, heldQuestionCount: 0, huroofQuestionCount: 14,
      categoryGameEligible: true, availability: "ready",
    }],
  })));
  const user = userEvent.setup();
  render(
    <ThemeProvider><MemoryRouter><HomeSurface joinForm={<form />} joinMessage={null} /></MemoryRouter></ThemeProvider>,
  );
  await screen.findByRole("link", { name: /فئة جاهزة/ });
  await user.type(screen.getByRole("searchbox", { name: "تصفية الفئات" }), "لا تطابق");
  expect(screen.getByText("لا توجد فئات تطابق البحث.")).toBeVisible();
});

it.each(["loading", "anonymous", "error"] as const)("preserves the %s hosting state without granting host access", async (status) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    source: "local_sqlite_import", huroofAvailable: false, categories: [],
  })));
  render(<ThemeProvider><MemoryRouter><FirebaseAuthContext.Provider value={{ ...loadingAuthContext, status }}>
    <HomeSurface joinForm={<form />} joinMessage={null} />
  </FirebaseAuthContext.Provider></MemoryRouter></ThemeProvider>);
  await screen.findByText("لا توجد فئات جاهزة للعرض حالياً.");
  if (status === "loading") {
    expect(screen.getByRole("button", { name: "جارٍ التحقق…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "جارٍ التحقق…" })).toHaveAttribute("aria-busy", "true");
  } else {
    expect(screen.getByRole("link", { name: "تسجيل الدخول للاستضافة" })).toHaveAttribute("href", "/login?returnTo=%2Fhost%2Fnew%3Fkind%3Dhuroof");
  }
  expect(screen.queryByRole("link", { name: "إنشاء مباراة" })).not.toBeInTheDocument();
});

it("expands real eligible categories and restores the concise list", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
    source: "local_sqlite_import", huroofAvailable: true,
    categories: Array.from({length: 8}, (_, index) => ({
      id: `tahadani-ready-${index}`, labelAr: `فئة جاهزة ${index}`, sourceOnly: true,
      questionCount: 14, heldQuestionCount: 0, huroofQuestionCount: 14,
      categoryGameEligible: true, availability: "ready",
    })),
  })));
  const user = userEvent.setup();
  render(<ThemeProvider><MemoryRouter><HomeSurface joinForm={<form />} joinMessage={null} /></MemoryRouter></ThemeProvider>);
  await screen.findByRole("button", {name: "عرض الفئات الأخرى (2)"});
  expect(screen.getAllByRole("link", {name:/فئة جاهزة/})).toHaveLength(6);
  await user.click(screen.getByRole("button", {name: "عرض الفئات الأخرى (2)"}));
  expect(screen.getAllByRole("link", {name:/فئة جاهزة/})).toHaveLength(8);
  await user.click(screen.getByRole("button", {name: "عرض الفئات المختصرة"}));
  expect(screen.getAllByRole("link", {name:/فئة جاهزة/})).toHaveLength(6);
});
