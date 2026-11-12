// Renders a scene to frames, then to MP4 and GIF. From the repository root:
//   pnpm video:promo      docs/video/promo.html    -> website/assets/kiln-promo.{mp4,gif}
//   pnpm video:factory    website/factory.html     -> website/assets/kiln-factory.{mp4,gif}
// Or: node docs/video/render.mjs <scene.html> <name> [out-dir]
// Needs ffmpeg on PATH and Chrome or Chromium (found automatically; set CHROME to override).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const SCENE = resolve(root, process.argv[2] ?? process.env.SCENE ?? "docs/video/promo.html");
const NAME = process.argv[3] ?? process.env.NAME ?? "kiln-promo";
const out = resolve(root, process.argv[4] ?? "website/assets");
const frames = process.env.FRAMES_DIR ?? join(here, ".frames");

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const pw = join(homedir(), "Library/Caches/ms-playwright");
  if (existsSync(pw))
    for (const d of readdirSync(pw)
      .filter((d) => d.startsWith("chromium-"))
      .sort()
      .reverse())
      candidates.push(
        join(pw, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"),
        join(pw, d, "chrome-mac/Chromium.app/Contents/MacOS/Chromium"),
      );
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error("No Chrome or Chromium found. Install Chrome, or set CHROME=/path/to/chrome.");
  return found;
}
if (!existsSync(SCENE)) throw new Error(`Scene not found: ${SCENE}`);
console.log(`rendering ${SCENE} -> ${join(out, NAME)}.{mp4,gif}`);
const FPS = 30,
  SCALE = 1.5;

rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
const browser = await puppeteer.launch({ executablePath: findChrome(), args: ["--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: SCALE });
await page.goto(pathToFileURL(SCENE).href + "?render=1", { waitUntil: "networkidle0" });
await page.evaluate(() => document.fonts.ready);
const duration = await page.evaluate(() => window.DURATION);
const total = Math.round(duration * FPS);
for (let i = 0; i < total; i++) {
  await page.evaluate((t) => window.render(t), i / FPS);
  await page.screenshot({ path: join(frames, `${String(i).padStart(5, "0")}.jpg`), type: "jpeg", quality: 92 });
  if (i % 150 === 0) console.log(`frame ${i}/${total}`);
}
await browser.close();

const ff = (args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
ff([
  "-framerate",
  String(FPS),
  "-i",
  join(frames, "%05d.jpg"),
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-crf",
  "20",
  "-pix_fmt",
  "yuv420p",
  "-movflags",
  "+faststart",
  join(out, `${NAME}.mp4`),
]);
const palette = join(frames, "palette.png");
const vf = "fps=12,scale=800:-1:flags=lanczos";
ff(["-i", join(out, `${NAME}.mp4`), "-vf", `${vf},palettegen=stats_mode=diff:max_colors=128`, palette]);
ff([
  "-i",
  join(out, `${NAME}.mp4`),
  "-i",
  palette,
  "-lavfi",
  `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
  join(out, `${NAME}.gif`),
]);
console.log(`wrote ${join(out, `${NAME}.mp4`)} and ${NAME}.gif`);
