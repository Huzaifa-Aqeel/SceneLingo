import { Link } from "react-router";
import type { User } from "firebase/auth";
import { ArrowRight, Inbox as InboxIcon, Layers } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCaptures } from "@/hooks/useCaptures";
import { useCards } from "@/hooks/useCards";
import { CATEGORY_LABEL } from "@/lib/schemas";
import { dueCount } from "@/lib/session";

export default function Home({ user }: { user: User }) {
  const { items } = useCaptures(user.uid);
  const { cards } = useCards(user.uid);
  if (!items || !cards) return <Skeleton className="h-72 w-full rounded-2xl" />;

  const fresh = items.filter((c) => c.status === "new").length;
  const due = dueCount(cards, new Date());
  const empty = fresh === 0 && cards.length === 0;

  return (
    <>
      <PageHeader title="Home" />
      {empty ? (
        <div className="rounded-2xl border border-dashed bg-card px-6 py-14 text-center">
          <p className="text-xl font-semibold">Start with a subtitle</p>
          <p className="mx-auto mt-1 max-w-sm text-muted-foreground">Click a line while you watch YouTube. It will appear in your Inbox.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Link to={due > 0 ? "/practice" : "/collection"} className="group rounded-2xl bg-primary p-6 text-primary-foreground shadow-sm transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring">
            <Layers className="size-6 opacity-90" aria-hidden />
            <p className="mt-4 text-4xl font-bold">{due}</p>
            <p className="opacity-90">{due === 1 ? "card due for practice" : "cards due for practice"}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium">{due > 0 ? "Practise" : "View collection"} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
          </Link>
          <Link to="/inbox" className="group rounded-2xl bg-card p-6 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring">
            <InboxIcon className="size-6 text-primary" aria-hidden />
            <p className="mt-4 text-4xl font-bold">{fresh}</p>
            <p className="text-muted-foreground">{fresh === 1 ? "new subtitle" : "new subtitles"}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">{fresh > 0 ? "Explore" : "Open Inbox"} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
          </Link>
        </div>
      )}
      {cards.length > 0 && (
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">Recently added</h2><Button asChild variant="link" className="h-auto p-0"><Link to="/collection">See all</Link></Button></div>
          <ul className="space-y-2">
            {cards.slice(0, 4).map((c) => (
              <li key={c.id}>
                <Link to={`/collection/${c.id}`} className="grid gap-1 rounded-2xl bg-card p-4 shadow-sm hover:shadow-md sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-6">
                  <div className="min-w-0"><p className="truncate font-semibold">{c.selectedText}</p><p className="text-xs text-muted-foreground">{CATEGORY_LABEL[c.category]}</p></div>
                  <p className="line-clamp-1 text-muted-foreground">{c.meaningEn}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
