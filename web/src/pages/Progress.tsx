import { useMemo } from "react";
import { Link } from "react-router";
import type { User } from "firebase/auth";
import { Empty } from "@/components/Empty";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCards, useReviewEvents } from "@/hooks/useCards";
import { summarize } from "@/lib/stats";

// "2026-11-06" -> "6 Nov" (in the learner's own date style)
const shortDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

export default function Progress({ user }: { user: User }) {
  const events = useReviewEvents(user.uid);
  const { cards } = useCards(user.uid);
  const stats = useMemo(() => (events ? summarize(events, new Date()) : null), [events]);
  if (!events || !stats || !cards) return <Skeleton className="h-72 w-full rounded-2xl" />;
  if (events.length === 0) {
    return (<><PageHeader title="Progress" /><Empty title="No practice yet" action={<Button asChild><Link to="/practice">Start practising</Link></Button>}>Your results will show up here.</Empty></>);
  }
  const max = Math.max(1, ...stats.recent.map((d) => d.total));
  const tiles = [
    { label: "Reviews", value: stats.total },
    { label: "Accuracy", value: stats.accuracy === null ? "–" : `${stats.accuracy}%` },
    { label: "Day streak", value: stats.streak },
    { label: "Cards", value: cards.length },
  ];

  return (
    <>
      <PageHeader title="Progress" />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => <div key={t.label} className="rounded-2xl bg-card p-4 shadow-sm"><p className="text-3xl font-bold">{t.value}</p><p className="text-sm text-muted-foreground">{t.label}</p></div>)}
      </div>
      <Card className="rounded-2xl">
        <CardHeader><CardTitle className="text-base">Last 14 days</CardTitle></CardHeader>
        <CardContent>
          <div className="flex h-32 items-end gap-1.5" role="img" aria-label={`Reviews per day over the last 14 days: ${stats.recent.map((d) => d.total).join(", ")}`}>
            {stats.recent.map((d) => (
              <div key={d.day} className="flex h-full flex-1 flex-col justify-end" title={`${d.day}: ${d.total} ${d.total === 1 ? "review" : "reviews"}, ${d.correct} correct`}>
                <div className="w-full rounded-t bg-primary/20" style={{ height: `${(d.total / max) * 100}%` }}>
                  <div className="w-full rounded-t bg-primary" style={{ height: d.total ? `${(d.correct / d.total) * 100}%` : 0 }} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 flex justify-between text-xs text-muted-foreground"><span>{shortDay(stats.recent[0]!.day)}</span><span>Today</span></p>
        </CardContent>
      </Card>
    </>
  );
}
