// Sentence segmentation at capture time (FR-SEG-001 / FR-CAP-004).
// Uses Intl.Segmenter, then re-joins splits after common titles ("Dr.", "Mrs.")
// that ICU treats as sentence ends. Falls back to a regex split if Intl.Segmenter
// is unavailable.

const TITLE_END = /\b(?:Mr|Mrs|Ms|Mx|Dr|Prof|Sr|Jr|St|Mt|Gen|Capt|Lt|Sgt|Col|vs)\.$/i;

function mergeTitles(parts) {
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    let cur = parts[i];
    while (TITLE_END.test(cur) && i + 1 < parts.length) {
      cur = `${cur} ${parts[++i]}`;
    }
    out.push(cur);
  }
  return out;
}

export function splitSentences(text) {
  const t = String(text ?? "").trim();
  if (!t) return [];
  let parts = [];
  try {
    if (typeof Intl !== "undefined" && Intl.Segmenter) {
      const seg = new Intl.Segmenter("en", { granularity: "sentence" });
      parts = [...seg.segment(t)].map((x) => x.segment.trim()).filter(Boolean);
    }
  } catch {
    parts = [];
  }
  if (!parts.length) {
    parts = t.split(/(?<=[.!?…]["')\]]?)\s+/).map((x) => x.trim()).filter(Boolean);
  }
  const merged = mergeTitles(parts);
  return merged.length ? merged : [t];
}
