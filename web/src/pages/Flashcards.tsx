import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { User } from "firebase/auth";
import { Check, X } from "lucide-react";
import { FlipCard } from "@/components/FlipCard";
import { TranslationView } from "@/components/TranslationView";
import { Empty } from "@/components/Empty";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { recordReview } from "@/data/cards";
import { useCards } from "@/hooks/useCards";
import { usePreferences } from "@/hooks/usePreferences";
import { translationKey } from "@/languages";
import type { LearningCard } from "@/lib/schemas";
import { buildSession, type SessionKind } from "@/lib/session";

const SET_LABEL: Record<SessionKind, string> = { due: "Due now", all: "Flashcards", mistakes: "Mistakes" };

export default function Flashcards({ user }: { user: User }) {
  const [params] = useSearchParams();
  const kind = (["due", "all", "mistakes"].includes(params.get("set") ?? "") ? params.get("set") : "all") as SessionKind;
  const { cards } = useCards(user.uid);
  const { prefs } = usePreferences(user.uid);
  const [attempt, setAttempt] = useState(0);

  // The session is fixed when it starts, so cards don't reshuffle as their review dates change.
  const [queue, setQueue] = useState<LearningCard[] | null>(null);
  useEffect(() => {
    if (cards && queue === null) setQueue(buildSession(cards, kind, new Date()));
  }, [cards, queue, kind]);

  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState(0);
  const [missed, setMissed] = useState<LearningCard[]>([]);
  const [requeued, setRequeued] = useState<Set<string>>(new Set());

  const current = queue?.[index];
  const total = queue?.length ?? 0;
  const done = queue !== null && index >= total;

  function rate(correct: boolean) {
    if (!current || !queue) return;
    void recordReview(user.uid, current, correct, kind === "mistakes" ? "mistakes" : "flashcard").catch(() => {});
    if (correct) setKnown((k) => k + 1);
    else {
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
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select")) return;
      if (e.key === "ArrowLeft") rate(false);
      else if (e.key === "ArrowRight") rate(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const translation = useMemo(() => {
    const code = prefs?.nativeLanguage;
    return current && code ? { code: translationKey(code), entry: current.translations[translationKey(code)] } : null;
  }, [current, prefs?.nativeLanguage]);

  if (!cards || queue === null) return <Skeleton className="mx-auto h-96 max-w-2xl rounded-3xl" />;
  if (total === 0) {
    return <Empty title={kind === "mistakes" ? "No mistakes to review" : "Nothing to study"} action={<Button asChild><Link to="/practice">Back to Practice</Link></Button>}>{kind === "due" ? "Nothing is due right now." : "You're all caught up."}</Empty>;
  }

  if (done) {
    return (
      <div className="mx-auto max-w-md space-y-6 py-10 text-center">
        <h1 className="text-3xl font-bold">Nice work</h1>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-card p-5 shadow-sm"><p className="text-3xl font-bold text-success">{known}</p><p className="text-sm text-muted-foreground">Got it</p></div>
          <div className="rounded-2xl bg-card p-5 shadow-sm"><p className="text-3xl font-bold text-warning">{missed.length}</p><p className="text-sm text-muted-foreground">Still learning</p></div>
        </div>
        <div className="flex flex-col gap-2">
          {missed.length > 0 && <Button size="lg" onClick={() => { setQueue([...missed]); setIndex(0); setKnown(0); setMissed([]); setRequeued(new Set()); setFlipped(false); setAttempt(attempt + 1); }}>Practise {missed.length} missed</Button>}
          <Button size="lg" variant="outline" asChild><Link to="/practice">Back to Practice</Link></Button>
        </div>
      </div>
    );
  }

  const c = current!;
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4 space-y-2">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <Link to="/practice" className="hover:text-foreground">Close</Link>
          <span>{SET_LABEL[kind]} · {index + 1} / {total}</span>
        </div>
        <Progress value={(index / total) * 100} aria-label="Progress" />
      </div>

      <FlipCard
        flipped={flipped}
        onFlip={() => setFlipped(!flipped)}
        front={<p className="text-balance text-3xl font-semibold sm:text-4xl">{c.selectedText}</p>}
        back={
          <div className="w-full space-y-3 text-left">
            <p className="text-xl font-medium">{c.meaningEn}</p>
            <p className="text-muted-foreground">{c.contextualMeaningEn}</p>
            {c.exampleSentences[0] && <p className="border-l-2 border-primary/40 pl-3">{c.exampleSentences[0]}</p>}
            {translation?.entry && <TranslationView code={translation.code} entry={translation.entry} hideSource />}
          </div>
        }
      />
      <p className="mt-3 text-center text-sm text-muted-foreground">{flipped ? "Did you know it?" : "Click the card or press Space to flip."}</p>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Button size="lg" variant="outline" className="h-14 border-warning/60 text-base text-warning hover:bg-warning/10 hover:text-warning" onClick={() => rate(false)}><X className="size-5" /> Still learning</Button>
        <Button size="lg" variant="outline" className="h-14 border-success/60 text-base text-success hover:bg-success/10 hover:text-success" onClick={() => rate(true)}><Check className="size-5" /> Got it</Button>
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">← Still learning · Got it →</p>
    </div>
  );
}
