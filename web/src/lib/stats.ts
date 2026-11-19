// Learning statistics, computed from review events (not from the current state of each card).

export interface EventLike { result: "correct" | "incorrect"; reviewedAt: Date }
export interface DayCount { day: string; total: number; correct: number }

const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function summarize(events: readonly EventLike[], now: Date, days = 14) {
  const total = events.length;
  const correct = events.filter((e) => e.result === "correct").length;
  const byDay = new Map<string, DayCount>();
  for (const e of events) {
    const k = key(e.reviewedAt);
    const c = byDay.get(k) ?? { day: k, total: 0, correct: 0 };
    c.total++;
    if (e.result === "correct") c.correct++;
    byDay.set(k, c);
  }
  const recent: DayCount[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    recent.push(byDay.get(key(d)) ?? { day: key(d), total: 0, correct: 0 });
  }
  // Streak: consecutive days with at least one review, counting back from today (or yesterday if today is empty).
  let streak = 0;
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!byDay.has(key(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (byDay.has(key(cursor))) { streak++; cursor.setDate(cursor.getDate() - 1); }
  return { total, correct, accuracy: total ? Math.round((correct / total) * 100) : null, streak, recent };
}
