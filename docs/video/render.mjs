// Renders a scene (promo.html by default) to frames, then to MP4 and GIF.
// Usage (from this folder):
//   npm i --no-save puppeteer-core
//   CHROME=/path/to/chrome [SCENE=../../website/factory.html NAME=kiln-factory] node render.mjs [out-dir]
// Needs ffmpeg on PATH. Writes <NAME>.mp4 and <NAME>.gif (default kiln-promo) to out-dir (default: ../../website/assets).
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? join(here, "../../website/assets"));
const frames = join(process.env.FRAMES_DIR ?? join(here, ".frames"));
const SCENE = process.env.SCENE ?? "promo.html", NAME = process.env.NAME ?? "kiln-promo";
const FPS = 30,
  SCALE = 1.5;

rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME, args: ["--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: SCALE });
await page.goto(pathToFileURL(join(here, SCENE)).href + "?render=1", { waitUntil: "networkidle0" });
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
