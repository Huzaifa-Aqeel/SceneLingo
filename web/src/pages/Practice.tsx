import { Link } from "react-router";
import type { User } from "firebase/auth";
import { Layers, ListChecks, Repeat2, RotateCcw } from "lucide-react";
import { Empty } from "@/components/Empty";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCards } from "@/hooks/useCards";
import { QUIZ_MIN_CARDS } from "@/lib/quiz";
import { dueCount, mistakes } from "@/lib/session";
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
  if (!cards) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (cards.length === 0) {
    return (<><PageHeader title="Practice" /><Empty title="Nothing to practise yet" action={<Button asChild><Link to="/inbox">Go to Inbox</Link></Button>}>Save a card from your Inbox first.</Empty></>);
  }
  const now = new Date();
  const due = dueCount(cards, now);
  const wrong = mistakes(cards).length;
  const reversible = cards.filter((c) => c.selectionKind !== "sentence").length;

  return (
    <>
      <PageHeader title="Practice" subtitle={`${cards.length} ${cards.length === 1 ? "card" : "cards"}`} />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-primary p-5 text-primary-foreground">
        <div>
          <p className="text-sm opacity-90">{due > 0 ? "Due now" : "All caught up"}</p>
          <p className="text-3xl font-bold">{due > 0 ? `${due} ${due === 1 ? "card" : "cards"}` : "Nothing due"}</p>
        </div>
        <Button asChild variant="secondary" size="lg"><Link to={due > 0 ? "/practice/flashcards" : "/practice/flashcards?set=all"}>{due > 0 ? "Start" : "Study anyway"}</Link></Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Tile to="/practice/flashcards" icon={Layers} title="Flashcards" text="See the term, recall the meaning." />
        <Tile to="/practice/flashcards?dir=reverse" icon={Repeat2} title="Reverse flashcards" text={reversible ? "See the meaning, recall the term." : "Needs a word or phrase card."} disabled={reversible === 0} />
        <Tile to="/practice/quiz" icon={ListChecks} title="Quiz" text={cards.length >= QUIZ_MIN_CARDS ? "Test yourself with three kinds of questions." : `Save ${QUIZ_MIN_CARDS - cards.length} more to unlock.`} disabled={cards.length < QUIZ_MIN_CARDS} />
        <Tile to="/practice/flashcards?set=mistakes" icon={RotateCcw} title="Review mistakes" text={wrong ? `${wrong} to revisit, most missed first.` : "No mistakes. Nice."} disabled={wrong === 0} />
      </div>
    </>
  );
}
