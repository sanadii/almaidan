import {render,screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {MemoryRouter,Route,Routes} from "react-router-dom";
import {ThemeProvider} from "../../src/app/ThemeProvider";
import {HomeSurface} from "../../src/routes/HomeSurface";
import {HostNewRoute} from "../../src/routes/GameRoutes";
import type {ApprovedReleaseCatalog} from "../../src/features/game/runtime/contracts";

const runtime = vi.hoisted(() => ({kind:"firebase",getApprovedReleaseCatalog:vi.fn()}));
vi.mock("../../src/features/game/runtime",()=>({gameRuntime:runtime}));
beforeEach(()=> {runtime.kind="firebase";runtime.getApprovedReleaseCatalog.mockReset();});
afterEach(() => vi.unstubAllGlobals());
const catalog: ApprovedReleaseCatalog = {
  releaseId:"reviewed",releaseRootSha256:"a".repeat(64),demoFixture:false,
  boardCapabilities:{huroof:true,categories:true,charades:false},
  categories:[
    {id:"ready",labelAr:"فئة معتمدة",playable:{huroof:true,categories:true,charades:false}},
    {id:"held",labelAr:"فئة محجوبة",playable:{huroof:true,categories:false,charades:false}},
    {id:"challenge",labelAr:"تحدٍ محجوب",playable:{huroof:false,categories:true,charades:false},challengeOnly:true,challengeKinds:["memory"]},
  ],
};
const renderHome=()=>render(<ThemeProvider><MemoryRouter><HomeSurface joinForm={<form/>} joinMessage={null}/></MemoryRouter></ThemeProvider>);

it("keeps approved-catalog discovery loading until an actual response",()=>{
  runtime.getApprovedReleaseCatalog.mockReturnValue(new Promise(()=>undefined));
  renderHome();
  expect(screen.getByText("جارٍ التحقق من الفئات المتاحة…")).toBeVisible();
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
});

it("recovers catalog errors and preserves the exact eligible category setup destination",async()=>{
  runtime.getApprovedReleaseCatalog.mockRejectedValueOnce(new Error("UNAVAILABLE")).mockResolvedValueOnce(catalog);
  const user=userEvent.setup();
  renderHome();
  await user.click(await screen.findByRole("button",{name:"أعد المحاولة"}));
  expect(await screen.findByRole("link",{name:/فئة معتمدة/})).toHaveAttribute("href","/host/new?kind=categories&category=ready");
  expect(screen.queryByText("فئة محجوبة")).not.toBeInTheDocument();
  expect(screen.queryByText("تحدٍ محجوب")).not.toBeInTheDocument();
  expect(runtime.getApprovedReleaseCatalog).toHaveBeenCalledTimes(2);
});

it("settles an empty approved catalog with no invented cards",async()=>{
  runtime.getApprovedReleaseCatalog.mockResolvedValue({...catalog,categories:[]});
  renderHome();
  expect(await screen.findByText("لا توجد فئات جاهزة للعرض حالياً.")).toBeVisible();
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
});

it("shows an explicit unavailable catalog in the content-free fixture runtime",()=>{
  runtime.kind="fixture";
  renderHome();
  expect(screen.getByText("لا تتوفر فئات للعرض حالياً.")).toBeVisible();
  expect(runtime.getApprovedReleaseCatalog).not.toHaveBeenCalled();
});

it("opens a local home category on setup using the inventory already loaded on home", async () => {
  runtime.kind = "local";
  const fetch = vi.fn(async () => Response.json({
    source: "local_saved_release", huroofAvailable: true,
    categories: [{ id: "tahadani-006", labelAr: "معلومات عامة", sourceOnly: false, questionCount: 30,
      heldQuestionCount: 0, huroofQuestionCount: 30, availability: "ready", categoryGameEligible: true }],
  }));
  vi.stubGlobal("fetch", fetch);
  render(<ThemeProvider><MemoryRouter><Routes>
    <Route path="/" element={<HomeSurface joinForm={<form />} joinMessage={null} />} />
    <Route path="/host/new" element={<HostNewRoute />} />
  </Routes></MemoryRouter></ThemeProvider>);
  await userEvent.click(await screen.findByRole("link", { name: /معلومات عامة/ }));
  expect(await screen.findByRole("button", { name: "معلومات عامة — محددة" })).toBeVisible();
  expect(fetch).toHaveBeenCalledTimes(1);
});
