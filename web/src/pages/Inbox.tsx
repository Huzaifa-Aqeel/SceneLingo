import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { User } from "firebase/auth";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/firebase";
import { Empty } from "@/components/Empty";
import { PageHeader } from "@/components/PageHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCaptures } from "@/hooks/useCaptures";
import { dayLabel, fmtTime, toDate } from "@/lib/format";

type Filter = "new" | "processed" | "dismissed";
const LABEL: Record<Filter, string> = { new: "New", processed: "Explored", dismissed: "Dismissed" };

export default function Inbox({ user }: { user: User }) {
  const { items, error } = useCaptures(user.uid);
  const [filter, setFilter] = useState<Filter>("new");
  const shown = useMemo(() => (items ?? []).filter((c) => c.status === filter), [items, filter]);
  const counts = useMemo(() => ({ new: items?.filter((c) => c.status === "new").length ?? 0, processed: 0, dismissed: 0 }), [items]);
  const setStatus = (id: string, status: Filter) => updateDoc(doc(db, "users", user.uid, "captures", id), { status });

  return (
    <>
      <PageHeader title="Inbox" subtitle={items ? (counts.new > 0 ? `${counts.new} new` : undefined) : undefined} />
      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)} className="mb-4">
        <TabsList>{(Object.keys(LABEL) as Filter[]).map((k) => <TabsTrigger key={k} value={k}>{LABEL[k]}</TabsTrigger>)}</TabsList>
      </Tabs>
      {error && <Alert role="alert" className="mb-3"><AlertDescription>{error}</AlertDescription></Alert>}
      {!items && !error && <div className="space-y-3"><Skeleton className="h-28 rounded-2xl" /><Skeleton className="h-28 rounded-2xl" /></div>}
      {items && shown.length === 0 && (
        filter === "new"
          ? <Empty title="You're all caught up" />
          : <Empty title="Nothing here" />
      )}
      <ul className="space-y-3">
        {shown.map((c) => {
          const d = toDate(c.capturedAt);
          return (
            <li key={c.id} className="rounded-2xl bg-card p-5 shadow-sm">
              <p className="text-lg">“{c.text}”</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {c.videoTitle}
                {c.videoUrl && <> · <a className="text-primary underline underline-offset-2" href={c.videoUrl} target="_blank" rel="noreferrer noopener">{fmtTime(c.playbackTimeSeconds)}</a></>}
                {d && <> · {dayLabel(d)}</>}
              </p>
              <div className="mt-3 flex gap-2">
                <Button asChild><Link to={`/explore/${c.id}`}>{filter === "processed" ? "Open" : "Explore"}</Link></Button>
                {filter === "dismissed" ? <Button variant="outline" onClick={() => setStatus(c.id, "new")}>Restore</Button> : filter === "new" && <Button variant="outline" onClick={() => setStatus(c.id, "dismissed")}>Dismiss</Button>}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
