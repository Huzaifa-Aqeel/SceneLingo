import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import type { User } from "firebase/auth";
import { Check, Loader2, Mic, Volume2 } from "lucide-react";
import { app } from "@/firebase";
import { judge, makeScene, replyStream, type Scene, type Verdict } from "@/ai/conversation";
import { Empty } from "@/components/Empty";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { recordReview } from "@/data/cards";
import { useCards } from "@/hooks/useCards";
import { inCategory, parseCategory, practiceUrl } from "@/lib/category";
import type { LearningCard } from "@/lib/schemas";
import { pickSeeds, readRecent, rememberSeed } from "@/lib/scenarios";
import { buildSession } from "@/lib/session";
import { createSpeaker, listenOnce, speak, speechSupported, stopSpeaking } from "@/lib/speech";
import { headline, learnerLines, marked, MAX_SILENCES, MAX_TURNS, NUDGES, outcomeOf, ratingOf, type Line, type Outcome } from "@/lib/talk";
import { cn } from "@/lib/utils";

type Phase = "preparing" | "ready" | "live" | "finishing" | "result" | "error";
type Turn = "partner" | "listening" | "thinking";

const target = (c: LearningCard) => c.selectedText.replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "");
const forModel = (c: LearningCard) => ({ ...c, videoTitle: c.source.videoTitle });

// An expression to talk about: the one asked for, otherwise a due one (never a whole sentence).
function chooseCard(cards: readonly LearningCard[], id: string | null, cat: ReturnType<typeof parseCategory>): LearningCard | null {
  const named = id ? cards.find((c) => c.id === id) : undefined;
  if (named && named.selectionKind !== "sentence") return named;
  const pool = inCategory(cards, cat).filter((c) => c.selectionKind !== "sentence");
  const few = buildSession(pool, "all", new Date(), 3);
  return few.length ? few[Math.floor(Math.random() * few.length)]! : null;
}

export default function Talk({ user }: { user: User }) {
  const [params] = useSearchParams();
  const cat = parseCategory(params.get("cat"));
  const home = practiceUrl("/practice", { cat });
  const { cards } = useCards(user.uid);

  const [card, setCard] = useState<LearningCard | null>(null);
  const [scene, setScene] = useState<Scene | null>(null);
  const [phase, setPhase] = useState<Phase>("preparing");
  const [turn, setTurn] = useState<Turn>("partner");
  const [lines, setLines] = useState<Line[]>([]);
  const [caption, setCaption] = useState("");      // what the partner is saying
  const [interim, setInterim] = useState("");      // what the learner is saying right now
  const [error, setError] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const stop = useRef(false);
  const listener = useRef<ReturnType<typeof listenOnce> | null>(null);
  const speaker = useRef<ReturnType<typeof createSpeaker> | null>(null);
  const linesRef = useRef<Line[]>([]);
  const started = useRef(false);

  const silence = useCallback(() => {
    stop.current = true;
    listener.current?.cancel();
    speaker.current?.stop();
    stopSpeaking();
  }, []);
  useEffect(() => silence, [silence]); // leaving the page ends everything

  // Set the scene for an expression.
  const prepare = useCallback(async (c: LearningCard) => {
    setPhase("preparing"); setError(""); setScene(null); setLines([]); linesRef.current = []; setCaption(""); setInterim(""); setVerdict(null); setOutcome(null);
    stop.current = false;
    try {
      const s = await makeScene({ app, card: forModel(c), seeds: pickSeeds(c.category, readRecent()) });
      rememberSeed(s.seedKey);
      setScene(s);
      setPhase("ready");
    } catch {
      setError("Couldn't set up the conversation. Please try again.");
      setPhase("error");
    }
  }, []);

  // Pick the expression once the cards are in.
  useEffect(() => {
    if (!cards || started.current || !speechSupported()) return;
    const c = chooseCard(cards, params.get("card"), cat);
    if (!c) return;
    started.current = true;
    setCard(c);
    void prepare(c);
  }, [cards, params, cat, prepare]);

  const talkCard = useMemo(() => (card ? forModel(card) : null), [card]);

  const finish = useCallback(async (c: LearningCard, s: Scene) => {
    silence();
    const all = linesRef.current;
    if (learnerLines(all).length === 0) { setError("We didn't hear anything. Check your microphone and try again."); setPhase("ready"); return; }
    setPhase("finishing");
    let v: Verdict | null = null;
    try { v = await judge({ app, scene: s, card: forModel(c), lines: all }); } catch { /* the result still shows, without the coach's note */ }
    const o = outcomeOf(all, target(c), c.selectionKind, v?.similarExpression ?? null);
    setVerdict(v); setOutcome(o); setPhase("result");
    void recordReview(user.uid, c, ratingOf(o), "conversation", { schedule: false }).catch(() => {});
  }, [silence, user.uid]);

  // The conversation: the partner speaks, the learner answers, the partner replies, up to MAX_TURNS times.
  async function run() {
    if (!card || !scene || !talkCard) return;
    stop.current = false; setError("");
    const add = (l: Line) => { linesRef.current = [...linesRef.current, l]; setLines(linesRef.current); };
    linesRef.current = []; setLines([]);
    setPhase("live");
    add({ who: "partner", text: scene.openingLine });
    setTurn("partner"); setCaption(scene.openingLine);
    await speak(scene.openingLine);

    let turns = 0, quiet = 0;
    while (!stop.current) {
      setTurn("listening"); setInterim("");
      listener.current = listenOnce({ phrases: [target(card)], onInterim: setInterim });
      const heard = await listener.current.done;
      setInterim("");
      if (stop.current) break;
      if (heard.kind === "denied") { setError("SceneLingo needs your microphone. Allow it in the address bar, then try again."); setPhase("ready"); return; }
      if (heard.kind === "error") { setError("The microphone didn't work. Check it and try again."); setPhase("ready"); return; }
      if (heard.kind === "silence") {
        if (++quiet >= MAX_SILENCES) break;
        setTurn("partner"); setCaption(NUDGES[quiet - 1]!);
        await speak(NUDGES[quiet - 1]!);
        continue;
      }
      quiet = 0;
      add({ who: "learner", text: heard.text });
      turns++;
      setTurn("thinking"); setCaption("");
      speaker.current = createSpeaker();
      let said = "";
      try {
        const reply = await replyStream({
          app, scene, card: talkCard, lines: linesRef.current, last: turns >= MAX_TURNS,
          isCancelled: () => stop.current,
          onText: (chunk) => { if (!said) setTurn("partner"); said += chunk; setCaption(said.trim()); speaker.current?.push(chunk); },
        });
        await speaker.current.finish();
        if (reply) add({ who: "partner", text: reply });
      } catch {
        speaker.current.stop();
        setError("The conversation was interrupted. Please try again.");
        setPhase("ready");
        return;
      }
      if (turns >= MAX_TURNS) break;
    }
    if (!stop.current || learnerLines(linesRef.current).length > 0) await finish(card, scene);
  }

  const endNow = () => { silence(); void finish(card!, scene!); };

  if (!speechSupported()) {
    return <Empty title="Talking needs a different browser" action={<Button asChild variant="outline"><Link to={home}>Back to Practice</Link></Button>}>Use Chrome or Edge on a computer with a microphone.</Empty>;
  }
  if (!cards) return <Skeleton className="mx-auto h-96 max-w-xl rounded-3xl" />;
  if (!card && phase === "preparing") {
    return <Empty title="Nothing to talk about yet" action={<Button asChild variant="outline"><Link to={home}>Back to Practice</Link></Button>}>Save a word or a phrase first.</Empty>;
  }

  const live = phase === "live";
  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 flex items-center justify-between text-sm text-muted-foreground">
        <Link to={home} className="hover:text-foreground">Close</Link>
        <span>Talk it out</span>
        {live ? <Button size="sm" variant="ghost" onClick={endNow}>End</Button> : <span className="w-10" />}
      </div>

      {phase === "preparing" && (
        <div className="rounded-3xl bg-card p-8 text-center shadow-[0_2px_16px_-4px_rgb(0_0_0/0.15)]" role="status">
          <Loader2 className="mx-auto size-6 animate-spin text-primary" aria-hidden />
          <p className="mt-3 text-muted-foreground">Setting the scene…</p>
        </div>
      )}

      {phase === "error" && (
        <Empty title="Something went wrong" action={<Button onClick={() => card && void prepare(card)}>Try again</Button>}>{error}</Empty>
      )}

      {(phase === "ready" || live) && scene && (
        <div className="rounded-3xl bg-card p-8 text-center shadow-[0_2px_16px_-4px_rgb(0_0_0/0.15)]">
          <p className="text-sm text-muted-foreground">{scene.partnerName} · {scene.partnerRole}</p>
          <p className="mt-2 text-balance text-xl">{scene.situation}</p>

          {phase === "ready" ? (
            <div className="mt-8 space-y-3">
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <Button size="lg" className="h-14 w-full text-base" onClick={() => void run()}><Mic className="size-5" /> Start talking</Button>
            </div>
          ) : (
            <div className="mt-8 flex flex-col items-center gap-4">
              <div className={cn("grid size-24 place-items-center rounded-full text-primary-foreground transition-colors", turn === "listening" ? "animate-pulse bg-success" : "bg-primary")} aria-hidden>
                {turn === "partner" ? <Volume2 className="size-10" /> : turn === "thinking" ? <Loader2 className="size-10 animate-spin" /> : <Mic className="size-10" />}
              </div>
              <p role="status" className="font-medium">{turn === "listening" ? "Listening…" : turn === "thinking" ? "Thinking…" : `${scene.partnerName} is speaking…`}</p>
              <p className="min-h-12 text-balance text-muted-foreground" aria-live="polite">{turn === "listening" ? interim : caption}</p>
            </div>
          )}
        </div>
      )}

      {phase === "finishing" && (
        <div className="rounded-3xl bg-card p-8 text-center shadow-[0_2px_16px_-4px_rgb(0_0_0/0.15)]" role="status">
          <Loader2 className="mx-auto size-6 animate-spin text-primary" aria-hidden />
          <p className="mt-3 text-muted-foreground">Looking at how it went…</p>
        </div>
      )}

      {phase === "result" && outcome && card && (
        <div className="space-y-4">
          <div className="rounded-3xl bg-card p-6 shadow-[0_2px_16px_-4px_rgb(0_0_0/0.15)]">
            <div className="flex items-center gap-2">
              <span className={cn("grid size-8 place-items-center rounded-full text-primary-foreground", outcome === "missed" ? "bg-warning" : "bg-success")}>{outcome === "missed" ? "·" : <Check className="size-5" aria-hidden />}</span>
              <h1 className="text-2xl font-bold">{headline(outcome)}</h1>
            </div>
            <p className="mt-3"><strong>{target(card)}</strong> <span className="text-muted-foreground">· {card.meaningEn}</span></p>
            {outcome === "similar" && verdict?.similarExpression && <p className="mt-1 text-sm text-muted-foreground">You said “{verdict.similarExpression}”, which means nearly the same.</p>}

            <h2 className="mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">What you said</h2>
            <ul className="mt-1 space-y-1">
              {learnerLines(lines).map((t, i) => (
                <li key={i} className="border-l-2 border-primary/40 pl-3">{marked(t, target(card)).map((p, j) => (p.on ? <mark key={j} className="rounded bg-primary/20 px-0.5 text-foreground">{p.text}</mark> : <span key={j}>{p.text}</span>))}</li>
              ))}
            </ul>

            {verdict && (
              <div className="mt-5 space-y-2">
                <p>{verdict.feedback}</p>
                {verdict.betterVersion && <p className="text-sm"><span className="text-muted-foreground">You could say:</span> “{verdict.betterVersion}”</p>}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Button size="lg" onClick={() => void prepare(card)}>Another scene</Button>
            <Button size="lg" variant="outline" asChild><Link to={home}>Back to Practice</Link></Button>
          </div>
        </div>
      )}
    </div>
  );
}
