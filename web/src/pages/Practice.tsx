import { Link, useSearchParams } from "react-router";
import type { User } from "firebase/auth";
import { Layers, ListChecks, Mic, Repeat2, RotateCcw } from "lucide-react";
import { Empty } from "@/components/Empty";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCards } from "@/hooks/useCards";
import { categoriesPresent, categoryName, inCategory, parseCategory, practiceUrl } from "@/lib/category";
import { QUIZ_MIN_CARDS } from "@/lib/quiz";
import { isSentenceCard } from "@/lib/text";
import { CATEGORY_PLURAL } from "@/lib/schemas";
import { dueCount, mistakes } from "@/lib/session";
import { speechSupported } from "@/lib/speech";
import { cn } from "@/lib/utils";

function Tile({ to, icon: Icon, title, text, disabled }: { to: string; icon: typeof Layers; title: string; text: string; disabled?: boolean }) {
  const body = (
    <>
      <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="size-6" aria-hidden /></span>
      <span className="mt-3 block text-lg font-semibold">{title}</span>
      <span className="mt-0.5 block text-sm text-muted-foreground">{text}</span>
    </>
  );
  const cls = "block rounded-2xl bg-card p-5 text-left shadow-sm transition-shadow";
  return disabled
    ? <div aria-disabled className={cn(cls, "opacity-50")}>{body}</div>
    : <Link to={to} className={cn(cls, "hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring")}>{body}</Link>;
}

export default function Practice({ user }: { user: User }) {
  const { cards } = useCards(user.uid);
  const [params, setParams] = useSearchParams();
  if (!cards) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (cards.length === 0) {
    return (<><PageHeader title="Practice" /><Empty title="Nothing to practise yet" action={<Button asChild><Link to="/inbox">Go to Inbox</Link></Button>}>Save a card from your Inbox first.</Empty></>);
  }
  const now = new Date();
  // The category row is for learners who have more than one kind of card; otherwise there is nothing to choose.
  const present = categoriesPresent(cards);
  const showRow = present.length >= 2;
  const picked = parseCategory(params.get("cat"));
  const cat = showRow && (picked === "all" || present.includes(picked)) ? picked : "all";
  const scoped = inCategory(cards, cat);
  const due = dueCount(scoped, now);
  const wrong = mistakes(scoped).length;
  const reversible = scoped.filter((c) => !isSentenceCard(c)).length;
  const where = categoryName(cat);
  const dueIn = (k: "all" | (typeof present)[number]) => dueCount(inCategory(cards, k), now);
  const choose = (k: string) => setParams(k === "all" ? {} : { cat: k }, { replace: true });

  return (
    <>
      <PageHeader title="Practice" subtitle={`${cards.length} ${cards.length === 1 ? "card" : "cards"}`} />
      {showRow && (
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Practise by type">
          {(["all", ...present] as const).map((k) => {
            const n = dueIn(k);
            const on = cat === k;
            return (
              <button key={k} type="button" aria-pressed={on} onClick={() => choose(k)}
                className={cn("rounded-full border px-3.5 py-1.5 text-sm transition-colors", on ? "border-primary bg-primary text-primary-foreground" : n === 0 ? "bg-card text-muted-foreground hover:bg-secondary" : "bg-card hover:bg-secondary")}>
                {k === "all" ? "All" : CATEGORY_PLURAL[k]} <span className={cn("ml-1 text-xs", on ? "opacity-80" : "text-muted-foreground")}>{n}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-primary p-5 text-primary-foreground">
        <div>
          <p className="text-sm opacity-90">{due > 0 ? "Due now" : "All caught up"}{where && ` · ${where}`}</p>
          <p className="text-3xl font-bold">{due > 0 ? `${due} ${due === 1 ? "card" : "cards"}` : "Nothing due"}</p>
        </div>
        <Button asChild variant="secondary" size="lg"><Link to={due > 0 ? practiceUrl("/practice/flashcards", { cat }) : practiceUrl("/practice/flashcards", { cat, set: "all" })}>{due > 20 ? "Start next 20" : due > 0 ? "Start" : "Study anyway"}</Link></Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Tile to={practiceUrl("/practice/flashcards", { cat })} icon={Layers} title="Flashcards" text="See the term, recall the meaning." />
        <Tile to={practiceUrl("/practice/flashcards", { cat, dir: "reverse" })} icon={Repeat2} title="Reverse flashcards" text={reversible ? "See the meaning, recall the term." : "Needs a word or phrase card."} disabled={reversible === 0} />
        <Tile to={practiceUrl("/practice/quiz", { cat })} icon={ListChecks} title="Quiz" text={cards.length >= QUIZ_MIN_CARDS ? "Test yourself with three kinds of questions." : `Save ${QUIZ_MIN_CARDS - cards.length} more to unlock.`} disabled={cards.length < QUIZ_MIN_CARDS} />
        <Tile to={practiceUrl("/practice/talk", { cat })} icon={Mic} title="Talk it out" text={!speechSupported() ? "Needs Chrome or Edge with a microphone." : reversible ? "Use it in a real conversation." : "Needs a word or phrase card."} disabled={!speechSupported() || reversible === 0} />
        <Tile to={practiceUrl("/practice/flashcards", { cat, set: "mistakes" })} icon={RotateCcw} title="Review mistakes" text={wrong ? `${wrong} to revisit, most missed first.` : "No mistakes. Nice."} disabled={wrong === 0} />
      </div>
    </>
  );
}
