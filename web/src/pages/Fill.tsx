import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { User } from "firebase/auth";
import { Empty } from "@/components/Empty";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { recordReview } from "@/data/cards";
import { useCards } from "@/hooks/useCards";
import type { LearningCard } from "@/lib/schemas";
import { buildSession } from "@/lib/session";
import { blankOut, isCorrectAnswer } from "@/lib/text";
import { cn } from "@/lib/utils";

export default function Fill({ user }: { user: User }) {
  const { cards } = useCards(user.uid);
  const [items, setItems] = useState<LearningCard[] | null>(null);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<boolean | null>(null);
  const [score, setScore] = useState(0);

  useEffect(() => {
    if (!cards || items) return;
    // Only cards whose sentence still contains the saved text can make a fair question.
    setItems(buildSession(cards.filter((c) => blankOut(c.sourceSentence, c.selectedText)), "all", new Date(), 10));
  }, [cards, items]);

  if (!cards || !items) return <Skeleton className="mx-auto h-80 max-w-2xl rounded-3xl" />;
  if (items.length === 0) return <Empty title="No sentences to practise" action={<Button asChild><Link to="/practice">Back to Practice</Link></Button>}>Cards need the sentence they came from.</Empty>;

  if (index >= items.length) {
    return (
      <div className="mx-auto max-w-md space-y-6 py-10 text-center">
        <h1 className="text-3xl font-bold">Done</h1>
        <div className="rounded-2xl bg-card p-6 shadow-sm"><p className="text-5xl font-bold">{score}<span className="text-2xl text-muted-foreground"> / {items.length}</span></p></div>
        <div className="flex flex-col gap-2">
          <Button size="lg" onClick={() => { setItems(null); setIndex(0); setScore(0); setAnswer(""); setResult(null); }}>Go again</Button>
          <Button size="lg" variant="outline" asChild><Link to="/practice">Back to Practice</Link></Button>
        </div>
      </div>
    );
  }

  const card = items[index]!;
  const parts = blankOut(card.sourceSentence, card.selectedText)!;

  function check(e: FormEvent) {
    e.preventDefault();
    if (result !== null) return;
    const ok = isCorrectAnswer(answer, card.selectedText);
    setResult(ok);
    if (ok) setScore((s) => s + 1);
    void recordReview(user.uid, card, ok, "fill").catch(() => {});
  }
  const next = () => { setIndex(index + 1); setAnswer(""); setResult(null); };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 space-y-2">
        <div className="flex items-center justify-between text-sm text-muted-foreground"><Link to="/practice" className="hover:text-foreground">Close</Link><span>Fill in the blank · {index + 1} / {items.length}</span></div>
        <Progress value={(index / items.length) * 100} aria-label="Progress" />
      </div>
      <div className="rounded-3xl bg-card p-8 shadow-[0_2px_16px_-4px_rgb(0_0_0/0.15)]">
        <p className="text-sm text-muted-foreground">Complete the sentence</p>
        <p className="mt-3 text-2xl leading-relaxed">
          {parts.before}
          <span className={cn("mx-1 inline-block min-w-24 border-b-2 text-center font-semibold", result === null ? "border-primary text-transparent" : result ? "border-success text-success" : "border-destructive text-destructive")}>
            {result === null ? "_____" : parts.match}
          </span>
          {parts.after}
        </p>
        <p className="mt-4 text-sm text-muted-foreground">Hint: {card.meaningEn}</p>
      </div>
      <form onSubmit={check} className="mt-4 space-y-3">
        <Input autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={result !== null} placeholder="Type the missing words" aria-label="Missing words" autoComplete="off" className="h-12 rounded-xl bg-card text-base" />
        <div className="flex items-center justify-between" aria-live="polite">
          <p className="text-sm font-medium">{result === null ? "" : result ? "Correct" : `Not quite. The answer is “${card.selectedText}”.`}</p>
          {result === null ? <Button size="lg" disabled={!answer.trim()}>Check</Button> : <Button type="button" size="lg" onClick={next} autoFocus>{index + 1 === items.length ? "Finish" : "Continue"}</Button>}
        </div>
      </form>
    </div>
  );
}
