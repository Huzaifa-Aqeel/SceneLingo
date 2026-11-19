import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { User } from "firebase/auth";
import { FlipCard } from "@/components/FlipCard";
import { FlashBack } from "@/components/FlashBack";
import { Empty } from "@/components/Empty";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { recordReview } from "@/data/cards";
import { useCards } from "@/hooks/useCards";
import { usePreferences } from "@/hooks/usePreferences";
import { translationKey } from "@/languages";
import type { LearningCard } from "@/lib/schemas";
import { gapFor, RATING_LABEL, RATINGS, type Rating } from "@/lib/schedule";
import { buildSession, type SessionKind } from "@/lib/session";
import { cn } from "@/lib/utils";

const SET_LABEL: Record<SessionKind, string> = { due: "Due now", all: "Flashcards", mistakes: "Mistakes" };
const TONE: Record<Rating, string> = {
  again: "border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive",
  hard: "border-warning/60 text-warning hover:bg-warning/10 hover:text-warning",
  good: "border-success/60 text-success hover:bg-success/10 hover:text-success",
  easy: "border-primary/60 text-primary hover:bg-primary/10 hover:text-primary",
};

export default function Flashcards({ user }: { user: User }) {
  const [params] = useSearchParams();
  const reverse = params.get("dir") === "reverse";
  const kind = (["due", "all", "mistakes"].includes(params.get("set") ?? "") ? params.get("set") : "all") as SessionKind;
  const { cards } = useCards(user.uid);
  const { prefs } = usePreferences(user.uid);

  // The session is fixed when it starts, so cards don't reshuffle as their review dates change.
  const [queue, setQueue] = useState<LearningCard[] | null>(null);
  useEffect(() => {
    // Reverse cards ask for the term, so a whole sentence can't be one.
    if (cards && queue === null) setQueue(buildSession(reverse ? cards.filter((c) => c.selectionKind !== "sentence") : cards, kind, new Date()));
  }, [cards, queue, kind, reverse]);

  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [tally, setTally] = useState<Record<Rating, number>>({ again: 0, hard: 0, good: 0, easy: 0 });
  const [missed, setMissed] = useState<LearningCard[]>([]);
  const [requeued, setRequeued] = useState<Set<string>>(new Set());

  const current = queue?.[index];
  const total = queue?.length ?? 0;
  const done = queue !== null && index >= total;
  const mode = reverse ? "reverse" : kind === "mistakes" ? "mistakes" : "flashcard";
  const ratings: readonly Rating[] = reverse ? ["again", "good"] : RATINGS;

  function rate(rating: Rating) {
    if (!current || !queue || !flipped) return;
    void recordReview(user.uid, current, rating, mode).catch(() => {});
    setTally((t) => ({ ...t, [rating]: t[rating] + 1 }));
    if (rating === "again") {
      setMissed((m) => [...m.filter((x) => x.id !== current.id), current]);
      if (!requeued.has(current.id)) { // a missed card comes round once more in this session
        setRequeued(new Set(requeued).add(current.id));
        setQueue([...queue, current]);
      }
    }
    setFlipped(false);
    setIndex(index + 1);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select")) return;
      if (!flipped) {
        // The card and the Reveal button handle their own Space and Enter; this covers focus on the page itself.
        if ((e.key === " " || e.key === "Enter") && e.target === document.body) { e.preventDefault(); setFlipped(true); }
        return;
      }
      if (reverse) {
        if (e.key === "ArrowLeft" || e.key === "1") rate("again");
        else if (e.key === "ArrowRight" || e.key === "2") rate("good");
      } else {
        const n = Number(e.key);
        if (n >= 1 && n <= 4) rate(RATINGS[n - 1]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const translation = useMemo(() => {
    const code = prefs?.nativeLanguage;
    const entry = current && code ? current.translations[translationKey(code)] : undefined;
    return entry && code ? { code: translationKey(code), entry } : null;
  }, [current, prefs?.nativeLanguage]);

  if (!cards || queue === null) return <Skeleton className="mx-auto h-96 max-w-2xl rounded-3xl" />;
  if (total === 0) {
    return <Empty title={kind === "mistakes" ? "No mistakes to review" : "Nothing to study"} action={<Button asChild><Link to="/practice">Back to Practice</Link></Button>}>{kind === "due" ? "Nothing is due right now." : "You're all caught up."}</Empty>;
  }

  if (done) {
    const remembered = tally.hard + tally.good + tally.easy;
    return (
      <div className="mx-auto max-w-md space-y-6 py-10 text-center">
        <h1 className="text-3xl font-bold">Nice work</h1>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-card p-5 shadow-sm"><p className="text-3xl font-bold text-success">{remembered}</p><p className="text-sm text-muted-foreground">Remembered</p></div>
          <div className="rounded-2xl bg-card p-5 shadow-sm"><p className="text-3xl font-bold text-warning">{missed.length}</p><p className="text-sm text-muted-foreground">To revisit</p></div>
        </div>
        <div className="flex flex-col gap-2">
          {missed.length > 0 && <Button size="lg" onClick={() => { setQueue([...missed]); setIndex(0); setTally({ again: 0, hard: 0, good: 0, easy: 0 }); setMissed([]); setRequeued(new Set()); setFlipped(false); }}>Practise {missed.length} missed</Button>}
          <Button size="lg" variant="outline" asChild><Link to="/practice">Back to Practice</Link></Button>
        </div>
      </div>
    );
  }

  const c = current!;
  const now = new Date();
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 space-y-2">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <Link to="/practice" className="hover:text-foreground">Close</Link>
          <span>{reverse ? "Reverse flashcards" : SET_LABEL[kind]} · {index + 1} / {total}</span>
        </div>
        <Progress value={(index / total) * 100} aria-label="Progress" />
      </div>

      <FlipCard
        flipped={flipped}
        onFlip={() => setFlipped(!flipped)}
        front={
          <div>
            <p className="mb-3 text-sm text-muted-foreground">{reverse ? "Which word or expression means this?" : "What does this mean?"}</p>
            <p className="text-balance text-3xl font-semibold sm:text-4xl">{reverse ? c.meaningEn : c.selectedText}</p>
          </div>
        }
        back={<FlashBack card={c} translation={translation} showTerm={reverse} />}
      />

      {!flipped ? (
        <Button size="lg" className="mt-4 h-14 w-full text-base" onClick={() => setFlipped(true)}>Reveal answer</Button>
      ) : (
        <>
          <p className="mt-3 text-center text-sm text-muted-foreground">How well did you know it?</p>
          <div className={cn("mt-2 grid gap-2 sm:gap-3", reverse ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4")}>
            {ratings.map((r) => (
              <Button key={r} size="lg" variant="outline" className={cn("h-auto flex-col gap-0 py-2.5 text-base", TONE[r])} onClick={() => rate(r)}>
                <span>{reverse ? (r === "again" ? "Missed it" : "Got it") : RATING_LABEL[r]}</span>
                {!reverse && <span className="text-xs font-normal opacity-80">{gapFor(c.review.reviewStage, r, now)}</span>}
              </Button>
            ))}
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">{reverse ? "Keys: 1 or ← Missed it · 2 or → Got it" : "Keys: 1 Again · 2 Difficult · 3 Good · 4 Easy"}</p>
        </>
      )}
    </div>
  );
}
