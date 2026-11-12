// Kiln docs on the website: search, the mobile menu, copy buttons and the active TOC heading.
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Mobile menu
  const menu = $("#menu");
  menu?.addEventListener("click", () => { const open = document.body.classList.toggle("nav-open"); menu.setAttribute("aria-expanded", String(open)); });
  $("#side")?.addEventListener("click", (e) => { if (e.target.closest("a")) document.body.classList.remove("nav-open"); });
  document.querySelector(".side a.on")?.scrollIntoView({ block: "center" });

  // Copy buttons
  document.querySelectorAll(".code .copy").forEach((b) => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.parentElement.querySelector("pre").innerText); b.textContent = "Copied"; } catch { b.textContent = "Select it"; }
    setTimeout(() => (b.textContent = "Copy"), 1500);
  }));

  // Active heading in "On this page"
  const toc = [...document.querySelectorAll(".toc a")];
  if (toc.length) {
    const targets = toc.map((a) => document.getElementById(a.getAttribute("href").slice(1))).filter(Boolean);
    const onScroll = () => {
      let cur = targets[0];
      for (const h of targets) if (h.getBoundingClientRect().top < 120) cur = h;
      toc.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === `#${cur?.id}`));
    };
    addEventListener("scroll", onScroll, { passive: true }); onScroll();
  }

  // Search
  const q = $("#q"), box = $("#results");
  let index = null, sel = 0, hits = [];
  const load = async () => { if (!index) { try { index = await (await fetch("/docs/search.json")).json(); } catch { index = []; } } return index; };
  const score = (doc, terms) => {
    let s = 0;
    for (const t of terms) {
      const title = doc.t.toLowerCase(), desc = doc.d.toLowerCase(), heads = doc.h.map((h) => h[0].toLowerCase()), body = doc.x.toLowerCase();
      if (title.includes(t)) s += title.startsWith(t) ? 12 : 8;
      else if (heads.some((h) => h.includes(t))) s += 5;
      else if (desc.includes(t)) s += 4;
      else if (body.includes(t)) s += 1;
      else return 0;
    }
    return s;
  };
  const show = () => {
    if (!q.value.trim()) { box.classList.remove("open"); return; }
    box.classList.add("open");
    box.innerHTML = hits.length ? hits.map((h, i) => `<a href="${h.url}" class="${i === sel ? "sel" : ""}" role="option"><small>${esc(h.doc.s)}</small><b>${esc(h.label)}</b><span>${esc(h.doc.d)}</span></a>`).join("") : `<div class="none">No pages match “${esc(q.value)}”.</div>`;
  };
  const search = async () => {
    const terms = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    const docs = await load();
    hits = terms.length ? docs.map((doc) => {
      const s = score(doc, terms); if (!s) return null;
      const head = doc.h.find((h) => terms.every((t) => h[0].toLowerCase().includes(t)));
      return { doc, s: s + (head ? 2 : 0), url: head ? `${doc.u}#${head[1]}` : doc.u, label: head ? `${doc.t} › ${head[0]}` : doc.t };
    }).filter(Boolean).sort((a, b) => b.s - a.s).slice(0, 10) : [];
    sel = 0; show();
  };
  q?.addEventListener("input", search);
  q?.addEventListener("focus", () => { load(); if (q.value) show(); });
  q?.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { sel = Math.min(sel + 1, hits.length - 1); show(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); show(); e.preventDefault(); }
    else if (e.key === "Enter" && hits[sel]) location.href = hits[sel].url;
    else if (e.key === "Escape") { q.blur(); box.classList.remove("open"); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== q && !/input|textarea/i.test(document.activeElement?.tagName)) { e.preventDefault(); q.focus(); }
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".search")) box.classList.remove("open"); });
})();
