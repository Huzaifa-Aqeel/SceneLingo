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
import { categoryName, inCategory, parseCategory, practiceUrl } from "@/lib/category";
import { RATING_LABEL, type Rating } from "@/lib/schedule";
import { isSentenceCard } from "@/lib/text";
import { buildSession, type SessionKind } from "@/lib/session";
import { cn } from "@/lib/utils";

const TONE: Record<Rating, string> = {
  again: "border-warning/60 text-warning hover:bg-warning/10 hover:text-warning",
  good: "border-success/60 text-success hover:bg-success/10 hover:text-success",
};
const RATINGS: readonly Rating[] = ["again", "good"];

// A new session starts whenever the mode changes (for example from "all caught up" to Practise anyway).
export default function Flashcards({ user }: { user: User }) {
  const [params] = useSearchParams();
  return <FlashcardSession key={`${params.get("set") ?? "due"}-${params.get("dir") ?? ""}-${params.get("cat") ?? ""}`} user={user} />;
}

function FlashcardSession({ user }: { user: User }) {
  const [params] = useSearchParams();
  const reverse = params.get("dir") === "reverse";
  const cat = parseCategory(params.get("cat"));
  const where = categoryName(cat);
  const home = practiceUrl("/practice", { cat });
  // Normally only the cards that are ready (due). "all" (Practise anyway) and "mistakes" are practice only: they never move a card.
  const kind: SessionKind = params.get("set") === "all" ? "all" : params.get("set") === "mistakes" ? "mistakes" : "due";
  const schedules = kind === "due";
  const { cards } = useCards(user.uid);
  const { prefs } = usePreferences(user.uid);

  // The session is fixed when it starts, so cards don't reshuffle as their review dates change.
  const [queue, setQueue] = useState<LearningCard[] | null>(null);
  useEffect(() => {
    // Reverse cards ask for the term, so a whole sentence can't be one.
    if (cards && queue === null) setQueue(buildSession(reverse ? inCategory(cards, cat).filter((c) => !isSentenceCard(c)) : inCategory(cards, cat), kind, new Date()));
  }, [cards, queue, kind, reverse, cat]);

  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [tally, setTally] = useState({ again: 0, good: 0 });

  const current = queue?.[index];
  const total = queue?.length ?? 0;
  const done = queue !== null && index >= total;
  const mode = reverse ? "reverse" : kind === "mistakes" ? "mistakes" : "flashcard";

  function rate(rating: Rating) {
    if (!current || !flipped) return;
    void recordReview(user.uid, current, rating, mode, { schedule: schedules }).catch(() => {});
    setTally((t) => ({ ...t, [rating]: t[rating] + 1 }));
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
      if (e.key === "ArrowLeft" || e.key === "1") rate("again");
      else if (e.key === "ArrowRight" || e.key === "2") rate("good");
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
    const back = <Button asChild variant="outline"><Link to={home}>Back to Practice</Link></Button>;
    if (kind === "mistakes") return <Empty title={where ? `No mistakes in ${where}` : "No mistakes to review"} action={back}>You're all caught up.</Empty>;
    return (
      <Empty title={where ? `You're all caught up in ${where}` : "You're all caught up"} action={<div className="flex gap-2"><Button asChild><Link to={practiceUrl("/practice/flashcards", { cat, set: "all", dir: reverse ? "reverse" : undefined })}>Practise anyway</Link></Button>{back}</div>}>
        Nothing is ready to practise right now.
      </Empty>
    );
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md space-y-6 py-10 text-center">
        <h1 className="text-3xl font-bold">Nice work</h1>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-card p-5 shadow-sm"><p className="text-3xl font-bold text-success">{tally.good}</p><p className="text-sm text-muted-foreground">Got it</p></div>
          <div className="rounded-2xl bg-card p-5 shadow-sm"><p className="text-3xl font-bold text-warning">{tally.again}</p><p className="text-sm text-muted-foreground">Still learning</p></div>
        </div>
        <Button size="lg" variant="outline" asChild><Link to={home}>Back to Practice</Link></Button>
      </div>
    );
  }

  const c = current!;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 space-y-2">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <Link to={home} className="hover:text-foreground">Close</Link>
          <span>{reverse ? "Reverse flashcards" : kind === "all" ? "Practise anyway" : kind === "mistakes" ? "Mistakes" : "Flashcards"}{where && ` · ${where}`} · {index + 1} / {total}</span>
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
          <div className="mt-4 grid grid-cols-2 gap-3">
            {RATINGS.map((r) => (
              <Button key={r} size="lg" variant="outline" className={cn("h-14 text-base", TONE[r])} onClick={() => rate(r)}>
                <span>{RATING_LABEL[r]}</span>
              </Button>
            ))}
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">Keys: 1 or ← Still learning · 2 or → Got it</p>
        </>
      )}
    </div>
  );
}
