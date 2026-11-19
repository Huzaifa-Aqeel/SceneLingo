import type { Timestamp } from "firebase/firestore";

export const fmtTime = (seconds: number | undefined): string => {
  const s = Math.floor(seconds || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
};

export const toDate = (ts: Timestamp | undefined): Date | null => (ts ? ts.toDate() : null);
export const dayLabel = (d: Date | null): string =>
  d ? d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : "";
