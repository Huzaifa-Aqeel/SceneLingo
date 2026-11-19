import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { User } from "firebase/auth";
import { Check, X } from "lucide-react";
import { Empty } from "@/components/Empty";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { recordReview } from "@/data/cards";
import { useCards } from "@/hooks/useCards";
import { buildOptions, type Option } from "@/lib/quiz";
import type { LearningCard } from "@/lib/schemas";
import { buildSession } from "@/lib/session";
import { cn } from "@/lib/utils";

interface Question { card: LearningCard; options: Option[] }

export default function Quiz({ user }: { user: User }) {
  const { cards } = useCards(user.uid);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [score, setScore] = useState(0);

  useEffect(() => {
    if (!cards || questions) return;
    const session = buildSession(cards, "all", new Date(), 10);
    const qs: Question[] = [];
    for (const card of session) {
      const options = buildOptions(card.meaningEn, cards.filter((c) => c.id !== card.id).map((c) => c.meaningEn));
      if (options) qs.push({ card, options });
    }
    setQuestions(qs);
  }, [cards, questions]);

  const q = questions?.[index];
  const answered = chosen !== null;

  function choose(i: number) {
    if (!q || answered) return;
    const ok = q.options[i]!.correct;
    setChosen(i);
    if (ok) setScore((s) => s + 1);
    void recordReview(user.uid, q.card, ok, "quiz").catch(() => {});
  }
  function next() { setChosen(null); setIndex(index + 1); }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!q) return;
      const n = Number(e.key);
      if (n >= 1 && n <= q.options.length) choose(n - 1);
      else if ((e.key === "Enter" || e.key === " ") && answered) { e.preventDefault(); next(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const total = questions?.length ?? 0;
  const letter = useMemo(() => ["1", "2", "3", "4"], []);

  if (!cards || !questions) return <Skeleton className="mx-auto h-96 max-w-2xl rounded-3xl" />;
  if (total === 0) return <Empty title="Not enough cards for a quiz" action={<Button asChild><Link to="/practice">Back to Practice</Link></Button>}>Save at least two cards with different meanings.</Empty>;

  if (index >= total) {
    const pct = Math.round((score / total) * 100);
    return (
      <div className="mx-auto max-w-md space-y-6 py-10 text-center">
        <h1 className="text-3xl font-bold">{pct >= 80 ? "Great job" : pct >= 50 ? "Good effort" : "Keep going"}</h1>
        <div className="rounded-2xl bg-card p-6 shadow-sm"><p className="text-5xl font-bold">{score}<span className="text-2xl text-muted-foreground"> / {total}</span></p><p className="mt-1 text-sm text-muted-foreground">{pct}% correct</p></div>
        <div className="flex flex-col gap-2">
          <Button size="lg" onClick={() => { setQuestions(null); setIndex(0); setScore(0); setChosen(null); }}>Try again</Button>
          <Button size="lg" variant="outline" asChild><Link to="/practice">Back to Practice</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 space-y-2">
        <div className="flex items-center justify-between text-sm text-muted-foreground"><Link to="/practice" className="hover:text-foreground">Close</Link><span>Quiz · {index + 1} / {total}</span></div>
        <Progress value={(index / total) * 100} aria-label="Progress" />
      </div>
      <div className="rounded-3xl bg-card p-8 shadow-[0_2px_16px_-4px_rgb(0_0_0/0.15)]">
        <p className="text-sm text-muted-foreground">What does this mean?</p>
        <p className="mt-2 text-balance text-3xl font-semibold">{q!.card.selectedText}</p>
        {q!.card.sourceSentence && <p className="mt-3 text-sm italic text-muted-foreground">“{q!.card.sourceSentence}”</p>}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2" role="group" aria-label="Choices">
        {q!.options.map((o, i) => {
          const picked = chosen === i;
          const state = !answered ? "idle" : o.correct ? "right" : picked ? "wrong" : "other";
          return (
            <button
              key={o.text}
              type="button"
              disabled={answered}
              onClick={() => choose(i)}
              className={cn(
                "flex min-h-20 items-start gap-3 rounded-2xl border-2 bg-card p-4 text-left transition-colors disabled:cursor-default",
                state === "idle" && "border-transparent shadow-sm hover:border-primary",
                state === "right" && "border-success bg-success/10",
                state === "wrong" && "border-destructive bg-destructive/10",
                state === "other" && "border-transparent opacity-60"
              )}
            >
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-xs">{state === "right" ? <Check className="size-4" aria-hidden /> : state === "wrong" ? <X className="size-4" aria-hidden /> : letter[i]}</span>
              <span>{o.text}{state === "right" && <span className="sr-only"> (correct)</span>}{state === "wrong" && <span className="sr-only"> (your answer, incorrect)</span>}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex items-center justify-between" aria-live="polite">
        <p className="text-sm font-medium">{!answered ? "" : q!.options[chosen!]!.correct ? "Correct" : "Not quite"}</p>
        {answered && <Button size="lg" onClick={next}>{index + 1 === total ? "See results" : "Continue"}</Button>}
      </div>
    </div>
  );
}
