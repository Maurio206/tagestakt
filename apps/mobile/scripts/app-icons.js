// @ts-check
/**
 * Erzeugt App-Icon, Adaptive-Icon-Vordergrund, Monochrom-Icon und Splash-Symbol aus dem
 * Master-SVG `assets/branding/tagestakt-logo.svg` – ohne Fremdpakete und reproduzierbar
 * (gleiches SVG → byte-identische PNGs).
 *
 *   pnpm --filter @tagestakt/mobile icons           # Dateien schreiben
 *   pnpm --filter @tagestakt/mobile icons -- --check  # nur prüfen, ob sie aktuell sind
 *
 * Das SVG darf nur <rect> (mit rx) und <circle> mit Hex-Füllfarbe enthalten; gerendert wird
 * per Distanzfeld mit Kantenglättung über einen Pixel.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { encodePng } = require("./png");

const ROOT = path.join(__dirname, "..");
const MASTER = "assets/branding/tagestakt-logo.svg";
const SIZE = 1024;
/** Android: 108 dp Fläche, sichtbar die mittleren 72 dp, Safe Zone Kreis ⌀ 66 dp. */
const ADAPTIVE = { canvas: 108, visible: 72, safeZoneDiameter: 66 };

/**
 * @typedef {"background" | "foreground"} Layer
 * @typedef {{ kind: "rect" | "circle", id: string, layer: Layer, fill: string, opacity: number,
 *   monoOpacity: number, x: number, y: number, width: number, height: number, rx: number,
 *   cx: number, cy: number, r: number }} Shape
 * @typedef {{ version: number, viewBox: number[], shapes: Shape[] }} Logo
 * @typedef {{ file: string, viewBox: number[], layers: Layer[], monochrome?: boolean }} Output
 */

/** @type {Output[]} */
const OUTPUTS = [
  // Normales Icon (iOS, ältere Android-Launcher): sichtbarer Bereich, vollflächig, deckend.
  { file: "assets/icon.png", viewBox: [18, 18, 72, 72], layers: ["background", "foreground"] },
  // Adaptive Icon: volle 108er-Fläche, transparent, Motiv innerhalb der Safe Zone.
  { file: "assets/adaptive-icon.png", viewBox: [0, 0, 108, 108], layers: ["foreground"] },
  // Themed Icon (Android 13+): eine Farbe, Hierarchie nur über Deckkraft.
  {
    file: "assets/adaptive-icon-monochrome.png",
    viewBox: [0, 0, 108, 108],
    layers: ["foreground"],
    monochrome: true,
  },
  // Splash-Symbol: Motiv mit schmalem Rand, transparent.
  { file: "assets/splash-icon.png", viewBox: [24, 24, 60, 60], layers: ["foreground"] },
];

/**
 * @param {string} svg
 * @returns {Logo}
 */
function parseLogo(svg) {
  const clean = svg.replace(/<!--[\s\S]*?-->/g, "");
  for (const [, tag] of clean.matchAll(/<\s*([a-zA-Z][\w:-]*)/g)) {
    if (!["svg", "rect", "circle"].includes(tag)) {
      throw new Error(`Nicht unterstütztes SVG-Element <${tag}> im Master-Logo`);
    }
  }
  const viewBox = (/viewBox="([^"]+)"/.exec(clean)?.[1] ?? "").split(/\s+/).map(Number);
  if (viewBox.length !== 4 || viewBox.some((n) => !Number.isFinite(n))) {
    throw new Error("viewBox fehlt oder ist ungültig");
  }
  const shapes = [...clean.matchAll(/<(rect|circle)\b([^>]*?)\/>/g)].map(([, kind, attrs]) => {
    /** @type {Record<string, string>} */
    const a = Object.fromEntries(
      [...attrs.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
    );
    /** @param {string} key @param {number} [fallback] */
    const num = (key, fallback) => {
      const value = a[key] === undefined ? fallback : Number(a[key]);
      if (value === undefined || !Number.isFinite(value)) {
        throw new Error(`${kind}#${a.id}: Attribut ${key} fehlt oder ist ungültig`);
      }
      return value;
    };
    if (!/^#[0-9A-Fa-f]{6}$/.test(a.fill ?? ""))
      throw new Error(`${kind}#${a.id}: fill muss #RRGGBB sein`);
    const layer = a["data-layer"];
    if (layer !== "background" && layer !== "foreground") {
      throw new Error(`${kind}#${a.id}: data-layer muss background oder foreground sein`);
    }
    const isRect = kind === "rect";
    return {
      kind: /** @type {"rect" | "circle"} */ (kind),
      id: a.id ?? "",
      layer,
      fill: a.fill.toUpperCase(),
      opacity: num("fill-opacity", 1),
      monoOpacity: num("data-mono-opacity", 1),
      x: isRect ? num("x") : 0,
      y: isRect ? num("y") : 0,
      width: isRect ? num("width") : 0,
      height: isRect ? num("height") : 0,
      rx: isRect ? num("rx", 0) : 0,
      cx: isRect ? 0 : num("cx"),
      cy: isRect ? 0 : num("cy"),
      r: isRect ? 0 : num("r"),
    };
  });
  return { version: Number(/data-version="(\d+)"/.exec(clean)?.[1] ?? 0), viewBox, shapes };
}

/** Vorzeichenbehafteter Abstand eines Punkts zum Rand der Form (negativ = innen). */
function signedDistance(
  /** @type {Shape} */ s,
  /** @type {number} */ px,
  /** @type {number} */ py,
) {
  if (s.kind === "circle") return Math.sqrt((px - s.cx) ** 2 + (py - s.cy) ** 2) - s.r;
  const hw = s.width / 2;
  const hh = s.height / 2;
  const r = Math.min(s.rx, hw, hh);
  const qx = Math.abs(px - (s.x + hw)) - hw + r;
  const qy = Math.abs(py - (s.y + hh)) - hh + r;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * Rendert die gewählten Ebenen in den Ausschnitt `viewBox` (quadratisch) als RGBA.
 * @param {Logo} logo
 * @param {{ size?: number, viewBox: number[], layers: Layer[], monochrome?: boolean }} options
 */
function render(logo, { size = SIZE, viewBox, layers, monochrome = false }) {
  const [vx, vy, vw] = viewBox;
  const unit = vw / size; // SVG-Einheiten je Pixel
  const shapes = logo.shapes
    .filter((s) => layers.includes(s.layer))
    .map((s) => ({
      shape: s,
      rgb: monochrome
        ? [255, 255, 255]
        : [1, 3, 5].map((i) => Number.parseInt(s.fill.slice(i, i + 2), 16)),
      alpha: monochrome ? s.monoOpacity : s.opacity,
    }));
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const py = vy + (y + 0.5) * unit;
    for (let x = 0; x < size; x += 1) {
      const px = vx + (x + 0.5) * unit;
      // Vormultipliziert zusammensetzen (Malreihenfolge = Dokumentreihenfolge).
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const { shape, rgb, alpha } of shapes) {
        const coverage = Math.min(1, Math.max(0, 0.5 - signedDistance(shape, px, py) / unit));
        if (coverage === 0) continue;
        const sa = coverage * alpha;
        r = rgb[0] * sa + r * (1 - sa);
        g = rgb[1] * sa + g * (1 - sa);
        b = rgb[2] * sa + b * (1 - sa);
        a = sa + a * (1 - sa);
      }
      const i = (y * size + x) * 4;
      if (a > 0) {
        data[i] = Math.round(r / a);
        data[i + 1] = Math.round(g / a);
        data[i + 2] = Math.round(b / a);
        data[i + 3] = Math.round(a * 255);
      }
    }
  }
  return { width: size, height: size, data };
}

/** @param {string} [root] */
function readLogo(root = ROOT) {
  return parseLogo(fs.readFileSync(path.join(root, MASTER), "utf8"));
}

/** Alle Ausgaben als PNG-Puffer (ohne zu schreiben). @param {Logo} logo */
function generate(logo) {
  return OUTPUTS.map((output) => ({ file: output.file, png: encodePng(render(logo, output)) }));
}

if (require.main === module) {
  const check = process.argv.includes("--check");
  const logo = readLogo();
  let stale = 0;
  for (const { file, png } of generate(logo)) {
    const target = path.join(ROOT, file);
    const hash = crypto.createHash("sha256").update(png).digest("hex").slice(0, 16);
    if (check) {
      const current = fs.existsSync(target) ? fs.readFileSync(target) : null;
      const ok = current !== null && current.equals(png);
      if (!ok) stale += 1;
      console.log(`${ok ? "aktuell " : "VERALTET"} ${file} (${hash}…)`);
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, png);
      console.log(`geschrieben ${file}: ${png.length} Bytes, SHA-256 ${hash}…`);
    }
  }
  if (stale > 0) {
    console.error(
      `${stale} Datei(en) veraltet – \`pnpm --filter @tagestakt/mobile icons\` ausführen.`,
    );
    process.exitCode = 1;
  }
}

module.exports = { ADAPTIVE, MASTER, OUTPUTS, SIZE, generate, parseLogo, readLogo, render };
