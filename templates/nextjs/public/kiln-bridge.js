// Kiln Studio's bridge: links what is on this page to the fragments of the App's Context.
// Studio shows this app in a frame on another origin, so the two sides talk with postMessage.
// The layout loads this file only while the dev server runs. It holds no secret and runs no
// code it is sent: it outlines elements, and tells Studio which fragment a clicked element is.
//
//   Studio → app   { type: "kiln:highlight", fragment: "<id>" }   outline that fragment's elements
//                  { type: "kiln:inspect", on: true | false }     the next click picks a fragment
//   app → Studio   { type: "kiln:ready" }                         this page has the bridge
//                  { type: "kiln:fragment", fragment: "<id>" }    the fragment that was clicked
(function () {
  var studio = window.parent;
  if (!studio || studio === window) return; // not in a frame: nothing to talk to

  var ATTRIBUTE = "data-kiln-fragment";
  var OUTLINE = "2px solid #6366f1";
  var HIGHLIGHT_MS = 2000;

  var inspecting = false;
  var hovered = null; // { clear } for the element under the pointer
  var highlighted = []; // [{ clear }] for the elements outlined by the last highlight
  var highlightTimer = null;

  function send(message) {
    // The fragment id is not a secret, and the bridge can't know Studio's origin.
    studio.postMessage(message, "*");
  }

  /** Outline an element; returns how to put its own outline back. */
  function outline(el) {
    var before = { outline: el.style.outline, offset: el.style.outlineOffset };
    el.style.outline = OUTLINE;
    el.style.outlineOffset = "2px";
    return {
      el: el,
      clear: function () {
        el.style.outline = before.outline;
        el.style.outlineOffset = before.offset;
      },
    };
  }

  /** The nearest element, from `target` up, that implements a fragment. */
  function fragmentElement(target) {
    return target && typeof target.closest === "function" ? target.closest("[" + ATTRIBUTE + "]") : null;
  }

  function clearHighlight() {
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = null;
    highlighted.forEach(function (h) {
      h.clear();
    });
    highlighted = [];
  }

  function highlight(fragment) {
    clearHighlight();
    var all = document.querySelectorAll("[" + ATTRIBUTE + "]");
    var found = [];
    // Compared as text, not put in a selector, so an odd id can't change what is matched.
    for (var i = 0; i < all.length; i += 1) if (all[i].getAttribute(ATTRIBUTE) === fragment) found.push(all[i]);
    if (!found.length) return;
    found[0].scrollIntoView({ block: "center", behavior: "smooth" });
    highlighted = found.map(outline);
    highlightTimer = setTimeout(clearHighlight, HIGHLIGHT_MS);
  }

  function clearHover() {
    if (hovered) hovered.clear();
    hovered = null;
  }

  function onHover(event) {
    var el = fragmentElement(event.target);
    if (hovered && hovered.el === el) return;
    clearHover();
    if (el) hovered = outline(el);
  }

  function onClick(event) {
    // In inspect mode a click picks; it must not also press the button or follow the link.
    event.preventDefault();
    event.stopPropagation();
    var el = fragmentElement(event.target);
    if (el) send({ type: "kiln:fragment", fragment: el.getAttribute(ATTRIBUTE) });
  }

  function inspect(on) {
    if (on === inspecting) return;
    inspecting = on;
    var change = on ? "addEventListener" : "removeEventListener";
    document[change]("click", onClick, true);
    document[change]("mouseover", onHover, true);
    document.documentElement.style.cursor = on ? "crosshair" : "";
    if (!on) clearHover();
  }

  window.addEventListener("message", function (event) {
    if (event.source !== studio) return; // only the page that frames this one
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "kiln:highlight" && typeof data.fragment === "string") highlight(data.fragment);
    else if (data.type === "kiln:inspect" && typeof data.on === "boolean") inspect(data.on);
    // Studio asks again when it starts listening after this page loaded.
    else if (data.type === "kiln:hello") send({ type: "kiln:ready" });
  });

  send({ type: "kiln:ready" });
})();
