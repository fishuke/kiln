import { studioFakeEnabled } from "@/lib/studio/flag";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const CSS = `:root{--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--card:#fff;--line:#e7e5e4;--accent:#ea580c;--soft:#fff7ed}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#fafaf9;--muted:#a8a29e;--card:#1c1917;--line:#292524;--soft:#1c1917}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--fg)}
header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 24px;border-bottom:1px solid var(--line)}
header b{font-size:17px}nav{display:flex;align-items:center;gap:16px;color:var(--muted);font-size:14px}main{max-width:760px;margin:0 auto;padding:32px 24px}
h1{font-size:28px;margin:0 0 4px}p.sub{color:var(--muted);margin:0 0 24px}.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.row{display:flex;align-items:center;gap:12px;margin-bottom:10px}.check{width:22px;height:22px;border-radius:7px;border:2px solid var(--line)}.done .check{background:var(--accent);border-color:var(--accent)}
.badge{margin-left:auto;font-size:13px;color:var(--accent);font-weight:600;background:var(--soft);border-radius:999px;padding:2px 10px}
.grid{display:grid;grid-template-columns:repeat(14,1fr);gap:4px;margin-top:24px}.grid i{aspect-ratio:1;border-radius:4px;background:var(--accent)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px}.thumb{height:110px;border-radius:10px;margin-bottom:10px}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 20px}.tag{border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:13px;color:var(--muted)}.tag.on{background:var(--fg);color:var(--bg);border-color:var(--fg)}
input{width:100%;font:inherit;padding:10px 14px;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--fg)}
.price{font-weight:600}.muted{color:var(--muted);font-size:13px}.toggle{width:30px;height:30px;border-radius:8px;border:1px solid var(--line);display:grid;place-items:center}
.starter{min-height:80vh;display:grid;place-items:center;text-align:center}.starter code{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:2px 6px}
@media (max-width:640px){.grid{grid-template-columns:repeat(7,1fr)}nav span{display:none}}`;

const MOON = `<span class="toggle" aria-label="Theme"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></span>`;

function page(name: string, nav: string[], body: string, toggle = false) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(name)}</title><style>${CSS}</style></head>
<body><header><b>${esc(name)}</b><nav>${nav.map((n) => `<span>${n}</span>`).join("")}${toggle ? MOON : ""}</nav></header><main>${body}</main></body></html>`;
}

function starter(name: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)}</title><style>${CSS}</style></head><body><div class="starter"><div><h1>${esc(name)}</h1><p class="sub">Get started by editing <code>app/page.tsx</code></p></div></div></body></html>`;
}

function habits(name: string, n: number) {
  const list = ["Read 20 pages", "Morning run", "No phone after 10pm", "Drink 2 litres of water", "Stretch for 10 minutes"];
  const streaks = [12, 5, 3, 21, 8];
  const rows = list
    .map(
      (h, i) =>
        `<div class="card row${i % 2 ? "" : " done"}"><span class="check"></span>${h}<span class="badge">${n >= 3 ? "&#9650; " : ""}${streaks[i]} days</span></div>`,
    )
    .join("");
  const heat =
    n >= 3
      ? `<h3 style="margin:28px 0 0">Last two weeks</h3><div class="grid">${Array.from({ length: 28 }, (_, i) => `<i style="opacity:${((((i * 37) % 10) + 1) / 10).toFixed(1)}"></i>`).join("")}</div>`
      : "";
  return page(name, ["Today", "History", "Settings"], `<h1>Today</h1><p class="sub">3 of 5 done</p>${rows}${heat}`, n >= 4);
}

function recipes(name: string, n: number) {
  const items: [string, string, string][] = [
    ["Lemon orzo with peas", "25 min", "#fde68a"],
    ["Miso salmon bowls", "30 min", "#fecaca"],
    ["Chickpea curry", "40 min", "#fed7aa"],
    ["Banana oat pancakes", "15 min", "#e9d5ff"],
    ["Roast tomato soup", "45 min", "#fecdd3"],
    ["Pesto gnocchi", "20 min", "#bbf7d0"],
  ];
  const cards = items
    .map(
      ([t, time, c]) =>
        `<div class="card"><div class="thumb" style="background:${c}"></div><div class="price">${t}</div><div class="muted">${time}</div></div>`,
    )
    .join("");
  const search =
    n >= 2
      ? `<input placeholder="Search recipes or ingredients"><div class="tags"><span class="tag on">Quick</span><span class="tag">Vegetarian</span><span class="tag">Dessert</span><span class="tag">Batch cook</span></div>`
      : "";
  return page(name, ["Recipes", "Shopping list"], `<h1>Recipes</h1><p class="sub">${items.length} saved</p>${search}<div class="cards">${cards}</div>`);
}

function store(name: string) {
  const items: [string, string, string][] = [
    ["Canvas tote", "$28", "#e7e5e4"],
    ["Ceramic mug", "$18", "#d6d3d1"],
    ["Linen apron", "$42", "#fde68a"],
    ["Notebook set", "$16", "#bfdbfe"],
  ];
  const cards = items
    .map(([t, p, c]) => `<div class="card"><div class="thumb" style="background:${c}"></div><div>${t}</div><div class="price">${p}</div></div>`)
    .join("");
  return page(
    name,
    ["Shop", "About", "Cart (0)"],
    `<h1>New in</h1><p class="sub">Small-batch goods for the kitchen and desk</p><div class="cards">${cards}</div>`,
  );
}

/**
 * A stand-in app for the fake Studio's preview iframe (NEXT_PUBLIC_KILN_STUDIO_FAKE=1 only): a small
 * page that matches the seeded App (`app`) at its version number (`n`).
 */
export async function GET(req: Request) {
  if (!studioFakeEnabled()) return new Response(null, { status: 404 });
  const url = new URL(req.url);
  const name = url.searchParams.get("app") ?? "App";
  const n = Number(url.searchParams.get("n") ?? "1");
  const kind = url.searchParams.get("kind");
  const html =
    kind === "store"
      ? store(name)
      : n <= 1 && kind !== "repo"
        ? starter(name)
        : /habit/i.test(name)
          ? habits(name, n)
          : /recipe/i.test(name)
            ? recipes(name, n)
            : starter(name);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
