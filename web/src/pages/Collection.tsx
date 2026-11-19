import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { User } from "firebase/auth";
import { Search } from "lucide-react";
import { Empty } from "@/components/Empty";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCards } from "@/hooks/useCards";
import { CATEGORIES, CATEGORY_LABEL, type Category } from "@/lib/schemas";
import { cn } from "@/lib/utils";

const PLURAL: Record<Category, string> = { vocabulary: "Vocabulary", idiom: "Idioms", slang: "Slang", expression: "Expressions" };

export default function Collection({ user }: { user: User }) {
  const { cards, error } = useCards(user.uid);
  const [filter, setFilter] = useState<Category | "all">("all");
  const [q, setQ] = useState("");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: cards?.length ?? 0 };
    for (const k of CATEGORIES) c[k] = cards?.filter((x) => x.category === k).length ?? 0;
    return c;
  }, [cards]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (cards ?? []).filter((c) => (filter === "all" || c.category === filter) && (!needle || `${c.selectedText} ${c.meaningEn} ${c.sourceSentence}`.toLowerCase().includes(needle)));
  }, [cards, filter, q]);

  return (
    <>
      <PageHeader title="My Collection" subtitle={cards ? `${cards.length} ${cards.length === 1 ? "card" : "cards"}` : undefined} actions={cards && cards.length > 0 ? <Button asChild><Link to="/practice">Practice</Link></Button> : undefined} />
      {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
      {!cards && !error && <div className="space-y-2"><Skeleton className="h-14 rounded-xl" /><Skeleton className="h-14 rounded-xl" /><Skeleton className="h-14 rounded-xl" /></div>}
      {cards && cards.length === 0 && (
        <Empty title="No cards yet" action={<Button asChild><Link to="/inbox">Go to Inbox</Link></Button>}>Save a card from your Inbox to get started.</Empty>
      )}
      {cards && cards.length > 0 && (
        <>
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your cards" aria-label="Search your cards" className="rounded-xl bg-card pl-9" />
          </div>
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter by type">
            {(["all", ...CATEGORIES] as const).map((k) => (
              <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
                className={cn("rounded-full border px-3.5 py-1.5 text-sm transition-colors", filter === k ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-secondary")}>
                {k === "all" ? "All" : PLURAL[k]} <span className={cn("ml-1 text-xs", filter === k ? "opacity-80" : "text-muted-foreground")}>{counts[k]}</span>
              </button>
            ))}
          </div>
          {shown.length === 0 ? <p className="py-8 text-center text-muted-foreground">No cards match.</p> : (
            <ul className="space-y-2">
              {shown.map((c) => (
                <li key={c.id}>
                  <Link to={`/collection/${c.id}`} className="grid gap-1 rounded-2xl bg-card p-4 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-6">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{c.selectedText}</p>
                      <Badge variant="secondary" className="mt-1 font-normal">{CATEGORY_LABEL[c.category]}</Badge>
                    </div>
                    <p className="line-clamp-2 text-muted-foreground">{c.meaningEn}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
