import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it } from "vitest";
import { ThemeProvider } from "../../src/app/ThemeProvider";
import { HomeSurface } from "../../src/routes/HomeSurface";

function renderHomepage() {
  return render(<ThemeProvider><MemoryRouter><HomeSurface staticPreview
    joinForm={<form><label htmlFor="test-room-code">رمز الغرفة<input id="test-room-code" /></label><button disabled>انضم إلى غرفة</button></form>}
    joinMessage={<p role="status">الانضمام غير متاح في المعاينة.</p>}
  /></MemoryRouter></ThemeProvider>);
}

it("offers five named navigation destinations with distinct standalone artwork", () => {
  const { container } = renderHomepage();
  const navigation = screen.getByRole("navigation", { name: "اكتشفوا الميدان" });
  const destinations = [
    ["العبوا الخلية", "game-choice-title"], ["جهّزوا المباراة", "create-match-title"],
    ["طريقة اللعب", "how-it-works"], ["استكشفوا الفئات", "category-chooser-title"],
    ["جمعة على كل جهاز", "gathering-title"],
  ];
  const images = new Set<string>();
  for (const [name, target] of destinations) {
    const link = within(navigation).getByRole("link", { name });
    expect(link).toHaveAttribute("href", `#${target}`);
    expect(container.querySelector(`[id="${target}"]`)).toHaveAttribute("tabindex", "-1");
    images.add(link.querySelector("img")!.getAttribute("src")!);
  }
  expect(within(navigation).getAllByRole("link")).toHaveLength(5);
  expect(images.size).toBe(5);
  expect(within(navigation).queryByRole("link", { name: /إنت صح/ })).not.toBeInTheDocument();
});

it("places the supplied form and its status once in setup, with guest anchors in the hero", async () => {
  const { container } = renderHomepage();
  const form = screen.getByLabelText("رمز الغرفة").closest("form")!;
  expect(container.querySelectorAll("form")).toHaveLength(1);
  expect(form.closest('[data-home-region="create-join-dock"]')).not.toBeNull();
  expect(screen.getByText("الانضمام غير متاح في المعاينة.").closest('[data-home-region="create-join-dock"]')).not.toBeNull();
  expect(screen.getByRole("button", { name: "انضم إلى غرفة" })).toBeDisabled();
  const user = userEvent.setup();
  await user.click(screen.getByRole("link", { name: "معك رمز غرفة؟" }));
  expect(screen.getByRole("link", { name: "معك رمز غرفة؟" })).toHaveAttribute("href", "#room-code");
  expect(container.querySelectorAll('[data-home-region]')).toHaveLength(13);
});


it("renders three clearly illustrative workflow phones with one 25-cell board and no pretend controls", () => {
  const { container } = renderHomepage();
  const examples = container.querySelectorAll(".maydan-showcase__examples > li");
  expect(examples).toHaveLength(3);
  expect(container.querySelectorAll(".maydan-honeycomb__cell")).toHaveLength(25);
  expect(container.querySelectorAll("[data-phone-preview]")).toHaveLength(4);
  for (const preview of container.querySelectorAll("[data-phone-preview]")) {
    expect(preview.querySelector("button,input,a,select,textarea,[tabindex]")).toBeNull();
    expect(preview.querySelector(".maydan-phone__label")).toBeNull();
  }
});

it("uses the selected full-bleed illustrated hero and dark closing around the common rail", () => {
  const { container } = renderHomepage();
  expect(container.querySelector(".maydan-hero__photo img")).toHaveAttribute("fetchpriority", "high");
  expect(container.querySelector(".maydan-hero__photo img")).toHaveAttribute("src", "/assets/backgrounds/home-games-fantasy-v1.webp");
  expect(container.querySelector(".maydan-hero__scene")).toBeNull();
  expect(container.querySelector(".maydan-final")).not.toHaveClass("maydan-section");
  expect(container.querySelector(".maydan-faq__items")!.querySelectorAll("details")).toHaveLength(6);
  expect(container.querySelector(".maydan-showcase")!.compareDocumentPosition(container.querySelector(".maydan-discovery")!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});

it("renders distinct full-screen illustrations and native sharing symbols without controls", () => {
  const { container } = renderHomepage();
  expect(container.querySelector(".maydan-phone--evening")).toBeNull();
  expect(container.querySelector(".maydan-phone--invite .maydan-phone__invitation")).not.toBeNull();
  expect(container.querySelector(".maydan-phone--host .maydan-phone__options")).not.toBeNull();
  expect(container.querySelector(".maydan-phone--join .maydan-phone__guest-card")).not.toBeNull();
  const sharing = container.querySelector(".maydan-sharing-illustration")!;
  expect(sharing.querySelectorAll(".maydan-sharing-illustration__role")).toHaveLength(3);
  expect(sharing.querySelector("button,a,input,[tabindex],img")).toBeNull();
  expect(sharing.querySelector(".maydan-illustration-label")).toBeNull();
});

it("keeps the three-line display, compact emblem and native FAQ chevrons", () => {
  const { container } = renderHomepage();
  expect(container.querySelectorAll("#maydan-hero-title > span")).toHaveLength(3);
  expect(document.body.querySelector(".app-header .brand-mark svg, .maydan-header .maydan-emblem svg")).not.toBeNull();
  expect(container.querySelector(".maydan-final .maydan-emblem--closing svg")).not.toBeNull();
  expect(container.querySelectorAll(".maydan-faq-chevron svg")).toHaveLength(6);
  expect(document.body.querySelector(".app-header .theme-toggle summary, .maydan-header .theme-toggle summary")).toHaveAccessibleName(/المظهر/);
});
