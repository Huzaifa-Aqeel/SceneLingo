// Capture-time validation (FR-CAP-012). The limits here must match firestore.rules.

export const MAX_TEXT = 1000;
export const MAX_TITLE = 300;
export const PLATFORMS = ["youtube", "netflix"];
export const SCHEMA_VERSION = 1;

const HOSTS = {
  youtube: /(^|\.)youtube\.com$/,
  netflix: /(^|\.)netflix\.com$/,
};

export const normalizeText = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

export function maskEmail(email) {
  const [name = "", domain = ""] = String(email ?? "").split("@");
  if (!name || !domain) return "your account";
  return `${name[0]}***@${domain}`;
}

export function parseVideoId(platform, url) {
  try {
    const u = new URL(url);
    if (platform === "youtube") {
      const v = u.searchParams.get("v");
      return v && /^[\w-]{6,20}$/.test(v) ? v : null;
    }
    const m = u.pathname.match(/\/watch\/(\d{3,12})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// cue: { text, time, site, title, url } as sent by the content script.
// Returns { ok: true, value } or { ok: false, reason }.
// reason "empty" means: do nothing and show nothing.
export function validateCue(cue) {
  const text = normalizeText(cue?.text);
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > MAX_TEXT) return { ok: false, reason: "too_long" };

  const platform = cue?.site;
  if (!PLATFORMS.includes(platform)) return { ok: false, reason: "bad_platform" };

  let url;
  try {
    url = new URL(cue?.url);
  } catch {
    return { ok: false, reason: "bad_url" };
  }
  if (url.protocol !== "https:" || !HOSTS[platform].test(url.hostname)) {
    return { ok: false, reason: "bad_url" };
  }

  const time = Number(cue?.time);
  if (!Number.isFinite(time) || time < 0) return { ok: false, reason: "bad_time" };

  return {
    ok: true,
    value: {
      text,
      platform,
      videoId: parseVideoId(platform, url.href),
      videoTitle: normalizeText(cue?.title).slice(0, MAX_TITLE) || "Untitled video",
      videoUrl: url.href,
      playbackTimeSeconds: Math.round(time * 1000) / 1000,
      subtitleLanguage: null,
    },
  };
}
