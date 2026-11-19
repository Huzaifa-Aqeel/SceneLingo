(() => {
  // One live copy per tab. If a live copy already answers, this one is a duplicate and stops.
  // (A copy left behind by an extension reload can no longer reach the extension, so it stays silent.)
  const root = document.documentElement;
  const alive = () => {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch { return false; }
  };
  root.removeAttribute("data-scenelingo-pong");
  document.dispatchEvent(new CustomEvent("scenelingo:ping"));
  if (root.getAttribute("data-scenelingo-pong") === "1") return;
  const ME = Math.random().toString(36).slice(2) + Date.now().toString(36);
  root.dataset.sceneLingoLive = ME;
  document.addEventListener("scenelingo:ping", () => { if (alive()) root.setAttribute("data-scenelingo-pong", "1"); });
  const newerCopyExists = () => root.dataset.sceneLingoLive !== ME;

  const SITE = location.hostname.includes("netflix") ? "netflix" : "youtube";

  // ---- Extraction: unchanged from the tested implementation ----------------------

  // Elements whose text makes up the current subtitle
  const TEXT_SELECTORS = {
    youtube: [".ytp-caption-window-container .caption-visual-line", ".ytp-caption-window-container .ytp-caption-segment"],
    netflix: [".player-timedtext-text-container"],
  };
  // Elements used to detect that the click landed on subtitle text
  // (Netflix subtitles ignore pointer events, so we hit-test by position)
  const HIT_SELECTORS = {
    youtube: [".ytp-caption-segment"],
    netflix: [".player-timedtext-text-container span"],
  };

  const clean = (s) => s.replace(/\s+/g, " ").trim();

  function getCurrentSubtitle() {
    for (const sel of TEXT_SELECTORS[SITE]) {
      const nodes = document.querySelectorAll(sel);
      if (nodes.length) {
        return clean(Array.from(nodes).map((n) => n.innerText || n.textContent).join(" "));
      }
    }
    return "";
  }

  function clickedOnSubtitle(x, y) {
    const pad = 6;
    for (const sel of HIT_SELECTORS[SITE]) {
      for (const el of document.querySelectorAll(sel)) {
        for (const r of el.getClientRects()) {
          if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) return true;
        }
      }
    }
    return false;
  }

  function getTitle() {
    if (SITE === "netflix") {
      const t = document.querySelector('[data-uia="video-title"]');
      if (t && t.innerText) return clean(t.innerText);
      return document.title;
    }
    return document.title.replace(/^\(\d+\)\s*/, "").replace(/ - YouTube$/, "");
  }

  function getUrl(t) {
    if (SITE === "youtube") {
      const u = new URL(location.href);
      u.searchParams.set("t", Math.floor(t) + "s");
      return u.href;
    }
    return location.href;
  }

  // ---- Toast ---------------------------------------------------------------------
  // The only thing this extension ever shows while you watch. Plain language only.

  function toast(msg, { link, onLink, ms = 1600 } = {}) {
    const host = document.fullscreenElement || document.body;
    const el = document.createElement("div");
    el.setAttribute("role", "status");
    el.style.cssText =
      "position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
      "background:rgba(20,20,20,.92);color:#fff;padding:8px 16px;border-radius:8px;" +
      "font:600 14px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);" +
      "pointer-events:none;max-width:80vw;";
    el.append(document.createTextNode(msg));
    if (link) {
      const a = document.createElement("button");
      a.type = "button";
      a.textContent = link;
      a.style.cssText =
        "margin-left:12px;padding:2px 8px;border:1px solid rgba(255,255,255,.5);border-radius:6px;" +
        "background:transparent;color:#fff;font:inherit;cursor:pointer;pointer-events:auto;";
      a.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        try { onLink?.(); } catch { /* extension reloaded */ }
        el.remove();
      }, true);
      el.append(a);
      ms = Math.max(ms, 6000);
    }
    host.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  const MESSAGES = {
    not_signed_in: "Sign in to SceneLingo to save this line.",
    reauth_required: "Sign in to SceneLingo to keep saving lines.",
    queue_full: "Couldn't save that line. Please try again later.",
    invalid: "Couldn't capture that line.",
    storage_error: "Couldn't capture that line.",
  };
  const UPDATED = "SceneLingo was updated. Refresh this page to keep capturing.";

  // ---- Capture -------------------------------------------------------------------

  const SIGNIN_QUIET_MS = 5 * 60 * 1000; // don't nag on ordinary caption clicks
  let lastSignInPrompt = 0;
  let last = null; // most recent capture, in memory only: { text, video, time }

  const videoKey = () => (SITE === "youtube" ? new URL(location.href).searchParams.get("v") || location.pathname : location.pathname);
  const send = (msg) => chrome.runtime.sendMessage(msg);

  async function capture() {
    const text = getCurrentSubtitle();
    if (!text) return;
    const video = document.querySelector("video");
    const time = video ? video.currentTime : 0;

    // Ignore double-clicks on the same line.
    if (last && last.text === text && last.video === videoKey() && Math.abs(last.time - time) < 3) return;

    if (!alive()) return newerCopyExists() ? undefined : toast(UPDATED, { ms: 3500 });

    let res;
    try {
      res = await send({
        type: "capture",
        cue: { text, time, site: SITE, title: getTitle(), url: getUrl(time) },
      });
    } catch {
      return newerCopyExists() ? undefined : toast(UPDATED, { ms: 3500 }); // extension was reloaded and nothing took over
    }
    if (!res) return toast(MESSAGES.storage_error);

    if (res.ok) {
      last = { text, video: videoKey(), time };
      toast("Subtitle captured ✓");
      if (res.attention) {
        setTimeout(() => toast("Some lines couldn't be saved.", { link: "Review", onLink: () => send({ type: "openAttention" }) }), 1800);
      }
      return;
    }
    if (res.reason === "empty") return; // nothing meaningful on screen: stay silent
    if (res.reason === "not_signed_in" || res.reason === "reauth_required") {
      if (Date.now() - lastSignInPrompt < SIGNIN_QUIET_MS) return;
      lastSignInPrompt = Date.now();
      return toast(MESSAGES[res.reason], { link: "Sign in", onLink: () => send({ type: "openSignIn" }) });
    }
    toast(MESSAGES[res.reason] || MESSAGES.storage_error);
  }

  // Capture phase so the player can't swallow the event
  window.addEventListener(
    "click",
    (e) => {
      if (e.button !== 0) return;
      if (clickedOnSubtitle(e.clientX, e.clientY)) capture();
    },
    true
  );
})();
