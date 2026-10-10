/**
 * Wochenraster auf schmalen Bildschirmen: kein Sprung an den Seitenanfang beim Antippen eines
 * Blocks, sanftes Scrollen zum Detailbereich, Vollbild über die Fullscreen-API bzw. als Ebene.
 * Alle Inhalte sind frei erfunden („(Beispiel)“).
 */
import { type ScheduleEntry, resolveTimeRange } from "@tagestakt/schedule-schema";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Link-Ersatz, der das `scroll`-Verhalten sichtbar macht (Next.js rendert es nicht ins DOM).
vi.mock("next/link", () => ({
  default: ({
    scroll,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { scroll?: boolean; children: ReactNode }) => (
    <a data-scroll={String(scroll)} {...props}>
      {children}
    </a>
  ),
}));

const { WeekGrid } = await import("./week-grid");
const { WeekGridFrame } = await import("./week-grid-frame");
const { RevealBlockDetails } = await import("./block-details-reveal");
const { BLOCK_DETAILS_ID } = await import("@/lib/block-details");

function entry(id: string, title: string, start: string, end: string): ScheduleEntry {
  const range = resolveTimeRange("2026-10-14", start, end, false);
  return {
    id,
    owner_id: "8f14e45f-ceea-4f6a-9d1b-6d2c4f0a9b11",
    schedule_week_id: "c9f0f895-fb98-4b91-9f5a-1c2d3e4f5a6b",
    title,
    category: "business",
    start_at: range.start.toISOString(),
    end_at: range.end.toISOString(),
    location: null,
    note: null,
    source: "manual",
    completion_status: "planned",
    created_at: "2026-10-01T00:00:00+00:00",
    updated_at: "2026-10-01T00:00:00+00:00",
  };
}

const BLOCKS = [
  entry("a", "Kundenprojekt (Beispiel)", "09:00", "11:00"),
  entry("b", "Angebot schreiben (Beispiel)", "14:00", "15:00"),
];

function grid(selectedId?: string) {
  return (
    <WeekGrid
      weekStart="2026-10-12"
      entries={BLOCKS}
      overlapIds={new Set()}
      today="2026-10-14"
      now={new Date("2026-10-14T08:00:00Z")}
      selectedId={selectedId}
      editHref={(e) => `/wochenplan?bearbeiten=${e.id}`}
      dayNotes={{
        dates: new Set(["2026-10-14"]),
        href: (date) => `/wochenplan?notiz=${date}#tagesnotiz`,
      }}
    />
  );
}

/** Detailbereich unterhalb des sichtbaren Fensters (oder an gegebener Position). */
function detailsAt(top: number) {
  const details = document.createElement("aside");
  details.id = BLOCK_DETAILS_ID;
  details.getBoundingClientRect = () => ({ top }) as DOMRect;
  document.body.append(details);
  return details;
}

let scrollIntoView: ReturnType<typeof vi.fn>;
const preventNavigation = (event: Event) => event.preventDefault();

beforeEach(() => {
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView as unknown as Element["scrollIntoView"];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  // jsdom kann nicht navigieren – Klicks auf Links hier enden lassen.
  document.addEventListener("click", preventNavigation);
});

afterEach(() => {
  document.removeEventListener("click", preventNavigation);
  document.getElementById(BLOCK_DETAILS_ID)?.remove();
  vi.unstubAllGlobals();
});

describe("Antippen eines Blocks", () => {
  it("Block-Links springen nicht an den Seitenanfang (scroll={false})", () => {
    render(grid());
    const links = screen.getAllByRole("link", { name: /bearbeiten$/ });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute("data-scroll", "false");
  });

  it("scrollt sanft zum Detailbereich, ohne Hash und nur bei neuer Auswahl", () => {
    detailsAt(1600);
    const { rerender } = render(<RevealBlockDetails entryId="a" />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(window.location.hash).toBe("");

    rerender(<RevealBlockDetails entryId="a" />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    rerender(<RevealBlockDetails entryId="b" />);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("scrollt nicht, wenn der Detailbereich schon im Blick ist", () => {
    detailsAt(120);
    render(<RevealBlockDetails entryId="a" />);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("„Bewegung reduzieren“: ohne sanfte Animation", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query.includes("reduce"),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    detailsAt(1600);
    render(<RevealBlockDetails entryId="a" />);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "start" });
  });

  it("erneutes Antippen des ausgewählten Blocks führt zu dessen Details", () => {
    detailsAt(1600);
    render(<WeekGridFrame>{grid("a")}</WeekGridFrame>);
    fireEvent.click(screen.getByRole("link", { name: /Kundenprojekt/ }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    // Ein anderer Block navigiert – dort übernimmt RevealBlockDetails nach dem Laden.
    fireEvent.click(screen.getByRole("link", { name: /Angebot schreiben/ }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

describe("Vollbild des Wochenrasters", () => {
  function frame() {
    return document.querySelector(".week-grid-frame");
  }

  it("ohne Fullscreen-API: bildschirmfüllende Ebene, Seite gesperrt, Esc beendet", () => {
    render(<WeekGridFrame>{grid()}</WeekGridFrame>);
    fireEvent.click(screen.getByRole("button", { name: "Vollbild" }));
    expect(frame()).toHaveClass("is-fullscreen");
    expect(frame()).toHaveAttribute("data-fullscreen", "overlay");
    expect(document.documentElement).toHaveClass("grid-fullscreen-open");
    expect(screen.getByRole("button", { name: "Vollbild beenden" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(frame()).not.toHaveClass("is-fullscreen");
    expect(document.documentElement).not.toHaveClass("grid-fullscreen-open");
    expect(screen.getByRole("button", { name: "Vollbild" })).toBeInTheDocument();
  });

  describe("mit Fullscreen-API", () => {
    let fullscreenElement: Element | null = null;
    const requestFullscreen = vi.fn(() => {
      fullscreenElement = document.querySelector(".week-grid-frame");
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
    const exitFullscreen = vi.fn(() => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });

    beforeEach(() => {
      fullscreenElement = null;
      requestFullscreen.mockClear();
      exitFullscreen.mockClear();
      Object.defineProperty(document, "fullscreenEnabled", { value: true, configurable: true });
      Object.defineProperty(document, "fullscreenElement", {
        get: () => fullscreenElement,
        configurable: true,
      });
      Object.defineProperty(document, "exitFullscreen", {
        value: exitFullscreen,
        configurable: true,
      });
      Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
        value: requestFullscreen,
        configurable: true,
      });
    });

    afterEach(() => {
      for (const key of ["fullscreenEnabled", "fullscreenElement", "exitFullscreen"]) {
        Reflect.deleteProperty(document, key);
      }
      Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
    });

    it("öffnet das Raster im echten Vollbild und folgt dem Beenden durch das System", async () => {
      render(<WeekGridFrame>{grid()}</WeekGridFrame>);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Vollbild" }));
      });
      expect(requestFullscreen).toHaveBeenCalledTimes(1);
      expect(fullscreenElement).toBe(frame());
      expect(frame()).toHaveAttribute("data-fullscreen", "native");
      expect(document.documentElement).toHaveClass("grid-fullscreen-open");

      // z. B. Android-Zurück oder Esc beendet das Vollbild systemseitig.
      act(() => {
        fullscreenElement = null;
        document.dispatchEvent(new Event("fullscreenchange"));
      });
      expect(frame()).toHaveAttribute("data-fullscreen", "off");
      expect(document.documentElement).not.toHaveClass("grid-fullscreen-open");
    });

    it("Antippen eines Blocks beendet das Vollbild; die Details folgen danach", async () => {
      detailsAt(1600);
      render(<WeekGridFrame>{grid("a")}</WeekGridFrame>);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Vollbild" }));
      });
      act(() => {
        fireEvent.click(screen.getByRole("link", { name: /Kundenprojekt/ }));
      });
      expect(exitFullscreen).toHaveBeenCalledTimes(1);
      expect(frame()).toHaveAttribute("data-fullscreen", "off");
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    });

    it("Markierung „Notiz“ beendet das Vollbild (Ziel liegt außerhalb des Rasters)", async () => {
      render(<WeekGridFrame>{grid()}</WeekGridFrame>);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Vollbild" }));
      });
      act(() => {
        fireEvent.click(screen.getByRole("link", { name: /^Tagesnotiz für .* öffnen$/ }));
      });
      expect(exitFullscreen).toHaveBeenCalledTimes(1);
      expect(frame()).toHaveAttribute("data-fullscreen", "off");
      expect(document.documentElement).not.toHaveClass("grid-fullscreen-open");
      expect(scrollIntoView).not.toHaveBeenCalled();
    });
  });
});

describe("Stundenzoom des Wochenrasters", () => {
  const wrap = () => document.querySelector<HTMLElement>(".week-grid-wrap")!;
  const zoomOut = () => screen.getByRole("button", { name: "Stunden herauszoomen" });
  const zoomIn = () => screen.getByRole("button", { name: "Stunden hineinzoomen" });

  it("staucht nur die Stunden in Stufen 100 / 75 / 50 % und zeigt die Stufe an", () => {
    render(<WeekGridFrame>{grid()}</WeekGridFrame>);
    expect(screen.getByRole("group", { name: "Stundenzoom" })).toBeInTheDocument();
    expect(wrap().style.getPropertyValue("--hour-zoom")).toBe("1");
    expect(screen.getByText(/100 %/)).toHaveTextContent("Stundenzoom 100 %");
    expect(zoomIn()).toBeDisabled();

    fireEvent.click(zoomOut());
    expect(wrap().style.getPropertyValue("--hour-zoom")).toBe("0.75");
    fireEvent.click(zoomOut());
    expect(wrap().style.getPropertyValue("--hour-zoom")).toBe("0.5");
    expect(screen.getByText(/50 %/)).toHaveTextContent("Stundenzoom 50 %");
    expect(zoomOut()).toBeDisabled();

    fireEvent.click(zoomIn());
    fireEvent.click(zoomIn());
    expect(wrap().style.getPropertyValue("--hour-zoom")).toBe("1");
  });

  it("die oberste sichtbare Stunde bleibt oben (senkrechte Position im Verhältnis)", () => {
    render(<WeekGridFrame>{grid()}</WeekGridFrame>);
    let scrollTop = 400;
    Object.defineProperty(wrap(), "scrollTop", {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = value;
      },
      configurable: true,
    });
    fireEvent.click(zoomOut());
    expect(scrollTop).toBe(300);
    fireEvent.click(zoomOut());
    expect(scrollTop).toBe(200);
    fireEvent.click(zoomIn());
    expect(scrollTop).toBe(300);
  });

  it("Zoomstufe bleibt beim Wechsel ins Vollbild und zurück erhalten", () => {
    render(<WeekGridFrame>{grid()}</WeekGridFrame>);
    fireEvent.click(zoomOut());
    fireEvent.click(screen.getByRole("button", { name: "Vollbild" }));
    expect(wrap().style.getPropertyValue("--hour-zoom")).toBe("0.75");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(wrap().style.getPropertyValue("--hour-zoom")).toBe("0.75");
  });
});
