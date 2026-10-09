/**
 * App-Icon, Adaptive Icon, Themed Icon und Startbildschirm: aus dem Master-SVG reproduzierbar,
 * richtige Abmessungen und Transparenz, Motiv in der Safe Zone, nur Farben aus den
 * Design-Tokens und korrekt in app.json eingebunden.
 */
import { blockColors, palettes } from "@tagestakt/design-tokens";

import appConfig from "../../app.json";

/** Node-Puffer (ohne @types/node im App-Projekt). */
type Bytes = Uint8Array & { toString: () => string };

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs") as {
  readFileSync: (path: string, encoding?: "utf8") => Bytes;
  existsSync: (path: string) => boolean;
};
const resolve = (require as unknown as { resolve: (path: string) => string }).resolve;

type Image = { width: number; height: number; data: Uint8Array; colorType?: number };
type Layer = "background" | "foreground";
type Shape = { id: string; layer: Layer; fill: string; monoOpacity: number };
const png = require("../../scripts/png") as {
  decodePng: (buffer: Bytes) => Image;
  encodePng: (image: Image) => Bytes;
  resize: (image: Image, width: number, height: number) => Image;
};
const icons = require("../../scripts/app-icons") as {
  ADAPTIVE: { canvas: number; visible: number; safeZoneDiameter: number };
  MASTER: string;
  OUTPUTS: { file: string; viewBox: number[]; layers: Layer[]; monochrome?: boolean }[];
  SIZE: number;
  parseLogo: (svg: string) => { version: number; viewBox: number[]; shapes: Shape[] };
};
const splash = require("../../plugins/with-android-splash") as {
  DENSITIES: Record<string, number>;
  applySplashColor: (colors: unknown, value: string) => { resources: { color: Xml[] } };
  applySplashStyle: (styles: unknown) => { resources: { style: Xml[] } };
  splashDrawableXml: () => string;
  splashLogos: (png: Bytes, widthDp: number) => Record<string, Bytes>;
  splashStylesV31Xml: () => string;
};
/* eslint-enable @typescript-eslint/no-require-imports */
type Xml = { $: { name: string; parent?: string }; _?: string; item?: Xml[] };

const mobileRoot = resolve("../../app.json").replace(/[\\/]app\.json$/, "");
const read = (file: string) => fs.readFileSync(`${mobileRoot}/${file.replace(/^\.\//, "")}`);
const image = (file: string) => png.decodePng(read(file));
const alpha = (img: Image, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3] ?? 0;
const rgb = (img: Image, x: number, y: number) => {
  const i = (y * img.width + x) * 4;
  return `#${[0, 1, 2].map((c) => (img.data[i + c] ?? 0).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
};

const dark = palettes.dark;
const logo = icons.parseLogo(read(icons.MASTER).toString());
const { android } = appConfig.expo;

describe("Master-Logo (SVG)", () => {
  it("ist versioniert und nutzt die Adaptive-Icon-Fläche 108 × 108", () => {
    expect(logo.version).toBeGreaterThanOrEqual(1);
    expect(logo.viewBox).toEqual([0, 0, 108, 108]);
  });

  it("verwendet ausschließlich Farben aus den Design-Tokens", () => {
    const tokenColors = new Set(
      [
        dark.bg,
        dark.lineStrong,
        dark.business,
        blockColors(dark, "duty", "muted").accent,
        blockColors(dark, "relationship", "muted").accent,
      ].map((c) => c.toUpperCase()),
    );
    for (const shape of logo.shapes) expect(tokenColors).toContain(shape.fill);
  });

  it("Fokusstapel: goldener aktueller Block dominant, Nachbarn gedämpft, Hintergrund Anthrazit", () => {
    const byId = Object.fromEntries(logo.shapes.map((s) => [s.id, s]));
    expect(byId.hintergrund?.fill).toBe(dark.bg.toUpperCase());
    expect(byId.jetzt?.fill).toBe(dark.business.toUpperCase());
    expect(byId.vorher?.fill).toBe(blockColors(dark, "duty", "muted").accent.toUpperCase());
    expect(byId.danach?.fill).toBe(blockColors(dark, "relationship", "muted").accent.toUpperCase());
    expect(byId.jetzt?.monoOpacity).toBe(1);
    expect(byId.vorher?.monoOpacity).toBeLessThan(1);
  });

  it("lehnt nicht unterstützte Elemente ab (z. B. Text)", () => {
    expect(() =>
      icons.parseLogo('<svg viewBox="0 0 108 108"><text x="1" y="1">T</text></svg>'),
    ).toThrow(/Nicht unterstütztes SVG-Element <text>/);
  });
});

describe("Erzeugte Assets", () => {
  it("sind aus dem Master-SVG reproduzierbar (byte-identisch, über das echte Skript)", () => {
    // Im Kindprozess: unter Jest/Babel wäre das Rendern von 4 × 1024² Pixeln sehr langsam.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { spawnSync } = require("child_process") as {
      spawnSync: (
        command: string,
        args: string[],
        options: { cwd: string; encoding: "utf8" },
      ) => { status: number | null; stdout: string; stderr: string };
    };
    const result = spawnSync(process.execPath, ["scripts/app-icons.js", "--check"], {
      cwd: mobileRoot,
      encoding: "utf8",
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    for (const { file } of icons.OUTPUTS) {
      expect(result.stdout).toContain(`aktuell  ${file}`);
    }
  });

  it("haben 1024 × 1024 Pixel mit Alphakanal", () => {
    for (const { file } of icons.OUTPUTS) {
      const img = image(file);
      expect([img.width, img.height, img.colorType]).toEqual([icons.SIZE, icons.SIZE, 6]);
    }
  });

  it("App-Icon: vollständig deckend, Hintergrund Anthrazit, goldener Block enthalten", () => {
    const img = image("assets/icon.png");
    let transparent = 0;
    for (let i = 3; i < img.data.length; i += 4) if (img.data[i] !== 255) transparent += 1;
    expect(transparent).toBe(0);
    expect(rgb(img, 0, 0)).toBe(dark.bg.toUpperCase());
    expect(rgb(img, 600, 512)).toBe(dark.business.toUpperCase());
  });

  it("Adaptive-Vordergrund: transparent, Motiv vollständig in der Safe Zone (⌀ 66 von 108)", () => {
    const img = image("assets/adaptive-icon.png");
    const radius = (icons.ADAPTIVE.safeZoneDiameter / 2 / icons.ADAPTIVE.canvas) * icons.SIZE;
    const center = icons.SIZE / 2;
    let opaque = 0;
    let farthest = 0;
    for (let y = 0; y < img.height; y += 1) {
      for (let x = 0; x < img.width; x += 1) {
        if (alpha(img, x, y) === 0) continue;
        opaque += 1;
        farthest = Math.max(farthest, Math.hypot(x + 0.5 - center, y + 0.5 - center));
      }
    }
    expect(farthest).toBeLessThanOrEqual(radius);
    expect(alpha(img, 0, 0)).toBe(0);
    expect(opaque).toBeGreaterThan(icons.SIZE * icons.SIZE * 0.05);
  });

  it("Themed Icon: eine Farbe (weiß), Hierarchie nur über Deckkraft", () => {
    const img = image("assets/adaptive-icon-monochrome.png");
    const levels = new Set<number>();
    let coloured = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3] === 0) continue;
      if (img.data[i] !== 255 || img.data[i + 1] !== 255 || img.data[i + 2] !== 255) coloured += 1;
      levels.add(img.data[i + 3] ?? 0);
    }
    expect(coloured).toBe(0);
    expect(levels.has(255)).toBe(true);
    expect([...levels].some((a) => a > 100 && a < 160)).toBe(true); // gedämpfte Nachbarn
  });

  it("Splash-Symbol: transparent mit Rand, goldener Block enthalten", () => {
    const img = image("assets/splash-icon.png");
    for (const [x, y] of [
      [0, 0],
      [1023, 0],
      [0, 1023],
      [1023, 1023],
      [512, 10],
    ] as const) {
      expect(alpha(img, x, y)).toBe(0);
    }
    expect(rgb(img, 600, 512)).toBe(dark.business.toUpperCase());
  });
});

describe("app.json", () => {
  const file = (path: string) => fs.existsSync(`${mobileRoot}/${path.replace(/^\.\//, "")}`);

  it("verweist auf vorhandene Icon-Dateien", () => {
    expect(appConfig.expo.icon).toBe("./assets/icon.png");
    expect(android.adaptiveIcon).toEqual({
      foregroundImage: "./assets/adaptive-icon.png",
      monochromeImage: "./assets/adaptive-icon-monochrome.png",
      backgroundColor: dark.bg,
    });
    for (const path of [
      appConfig.expo.icon,
      android.adaptiveIcon.foregroundImage,
      android.adaptiveIcon.monochromeImage,
    ]) {
      expect(file(path)).toBe(true);
    }
  });

  it("konfiguriert den Startbildschirm in Anthrazit mit dem Splash-Symbol", () => {
    const entry = appConfig.expo.plugins.find(
      (p) => Array.isArray(p) && p[0] === "./plugins/with-android-splash",
    ) as [string, { image: string; imageWidth: number; backgroundColor: string }] | undefined;
    expect(entry?.[1]).toEqual({
      image: "./assets/splash-icon.png",
      imageWidth: 160,
      backgroundColor: dark.bg,
    });
    expect(file(entry?.[1].image ?? "")).toBe(true);
    expect(appConfig.expo.backgroundColor).toBe(dark.bg);
  });

  it("Paketname, Version und Release-Plugin unverändert, versionCode 3", () => {
    expect(android.package).toBe("app.tagestakt.privat");
    expect(appConfig.expo.version).toBe("0.1.0");
    expect(android.versionCode).toBe(3);
    expect(appConfig.expo.plugins).toContain("./plugins/with-android-release");
  });
});

describe("Splash-Plugin (Android)", () => {
  it("ersetzt den gestreckten Platzhalter durch Farbe plus zentriertes Symbol", () => {
    const styles = splash.applySplashStyle({
      resources: {
        style: [
          { $: { name: "AppTheme" }, item: [] },
          {
            $: { name: "Theme.App.SplashScreen", parent: "AppTheme" },
            item: [{ $: { name: "android:windowBackground" }, _: "@drawable/splashscreen_logo" }],
          },
        ],
      },
    });
    const theme = styles.resources.style.find((s) => s.$.name === "Theme.App.SplashScreen");
    expect(theme?.item).toEqual([
      { $: { name: "android:windowBackground" }, _: "@drawable/splashscreen" },
    ]);
    expect(splash.splashDrawableXml()).toMatch(/@color\/splashscreen_background/);
    expect(splash.splashDrawableXml()).toMatch(/android:gravity="center"/);
  });

  it("setzt die Hintergrundfarbe (Vorlage: weiß) und Android 12+ auf Anthrazit", () => {
    const colors = splash.applySplashColor(
      { resources: { color: [{ $: { name: "splashscreen_background" }, _: "#FFFFFF" }] } },
      dark.bg,
    );
    expect(colors.resources.color).toEqual([
      { $: { name: "splashscreen_background" }, _: dark.bg },
    ]);
    expect(splash.splashStylesV31Xml()).toMatch(
      /android:windowSplashScreenBackground">@color\/splashscreen_background/,
    );
  });

  it("erzeugt das Symbol für jede Dichte in der richtigen Größe", () => {
    const logos = splash.splashLogos(read("assets/splash-icon.png"), 160);
    for (const [density, factor] of Object.entries(splash.DENSITIES)) {
      const img = png.decodePng(logos[density] as Bytes);
      expect([img.width, img.height]).toEqual([160 * factor, 160 * factor]);
      expect(alpha(img, 0, 0)).toBe(0);
    }
  });
});
