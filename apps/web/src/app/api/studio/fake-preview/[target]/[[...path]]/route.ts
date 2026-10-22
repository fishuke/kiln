import { studioFakeEnabled } from "@/lib/studio/flag";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * A stand-in app for the fake Studio's preview iframe (KILN_STUDIO_FAKE=1 only): a small page that
 * shows which version and route it is, so the preview pane can be tried and screenshotted.
 */
export async function GET(req: Request, { params }: { params: Promise<{ target: string; path?: string[] }> }) {
  if (!studioFakeEnabled()) return new Response(null, { status: 404 });
  const { target, path = [] } = await params;
  const url = new URL(req.url);
  const title = url.searchParams.get("title") ?? "New app";
  const n = Number(url.searchParams.get("n") ?? "1");
  const route = `/${path.join("/")}`;
  const habits = ["Read 20 pages", "Morning run", "No phone after 10pm", "Drink water", "Stretch"].slice(0, Math.min(5, 2 + n));
  const cells = Array.from({ length: 28 }, (_, i) => `<i style="opacity:${(((i * 37 + n * 11) % 10) / 10 + 0.1).toFixed(2)}"></i>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--card:#fff;--line:#e7e5e4;--accent:#ea580c}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#fafaf9;--muted:#a8a29e;--card:#1c1917;--line:#292524}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--fg)}
header{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;border-bottom:1px solid var(--line)}
header b{font-size:17px}nav{display:flex;gap:16px;color:var(--muted);font-size:14px}main{max-width:720px;margin:0 auto;padding:32px 24px}
h1{font-size:28px;margin:0 0 4px}p{color:var(--muted);margin:0 0 24px}.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;display:flex;align-items:center;gap:12px;margin-bottom:10px}
.check{width:22px;height:22px;border-radius:7px;border:2px solid var(--line)}.done .check{background:var(--accent);border-color:var(--accent)}
.flame{margin-left:auto;font-size:13px;color:var(--accent);font-weight:600}.grid{display:grid;grid-template-columns:repeat(14,1fr);gap:4px;margin-top:24px}
.grid i{aspect-ratio:1;border-radius:4px;background:var(--accent)}small{display:block;margin-top:28px;color:var(--muted);font-size:12px}
@media (max-width:640px){.grid{grid-template-columns:repeat(7,1fr)}nav{display:none}}
</style></head><body><header><b>Streaks</b><nav><span>Today</span><span>History</span><span>Settings</span></nav></header>
<main><h1>${route === "/" ? "Today" : esc(route.slice(1))}</h1><p>${esc(title)}</p>
${habits.map((h, i) => `<div class="card${i % 2 ? "" : " done"}"><span class="check"></span>${esc(h)}<span class="flame">${3 + ((i * 5 + n) % 12)}</span></div>`).join("")}
<div class="grid">${cells}</div><small>Preview of ${esc(target)} · version ${n} · ${esc(route)}</small></main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
