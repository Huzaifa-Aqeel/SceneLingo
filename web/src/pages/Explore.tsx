import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { User } from "firebase/auth";
import { doc, updateDoc } from "firebase/firestore";
import { Check, Languages, Loader2, Pencil, RotateCcw } from "lucide-react";
import { app, db } from "@/firebase";
import { explain, type ExplainResult } from "@/ai/englishCard";
import { translateCard, type TranslationResult } from "@/ai/translate";
import { routeFor } from "@/ai/support";
import { useLanguageSupport } from "@/ai/useSupport";
import { CardBody } from "@/components/CardBody";
import { PageHeader } from "@/components/PageHeader";
import { SourceBadge } from "@/components/SourceBadge";
import { TranslationView } from "@/components/TranslationView";
import { WordSelector } from "@/components/WordSelector";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { OnDevicePrompt } from "@/components/OnDevicePrompt";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { saveCard } from "@/data/cards";
import { useCaptures } from "@/hooks/useCaptures";
import { usePreferences } from "@/hooks/usePreferences";
import { findLanguage } from "@/languages";
import { fmtTime } from "@/lib/format";
import { CATEGORY_LABEL } from "@/lib/schemas";
import { selectedFrom, splitSentences, wordsOf, type Selection } from "@/lib/text";

const SLOW_AFTER_MS = 8000;

export default function Explore({ user }: { user: User }) {
  const { captureId } = useParams();
  const navigate = useNavigate();
  const { items } = useCaptures(user.uid);
  const capture = items?.find((c) => c.id === captureId);
  const { prefs } = usePreferences(user.uid);
  const { support, promptApiPresent } = useLanguageSupport();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [edited, setEdited] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);

  const [busy, setBusy] = useState<"explain" | "translate" | "save" | null>(null);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ExplainResult | null>(null);
  const [translations, setTranslations] = useState<Record<string, TranslationResult>>({});
  const [saved, setSaved] = useState<{ id: string; existed: boolean } | null>(null);
  const run = useRef(0); // lets a newer request (or Cancel) discard a slower, older one

  const text = edited ?? capture?.text ?? "";
  const sentences = useMemo(() => (edited !== null ? splitSentences(edited) : capture?.sentences.length ? capture.sentences : splitSentences(capture?.text ?? "")), [edited, capture]);

  const sentence = selection ? sentences[selection.sentenceIndex] : undefined;
  const selected = useMemo(() => (selection && sentence ? selectedFrom(sentence, wordsOf(sentence), selection) : null), [selection, sentence]);

  // A different selection means a different card.
  useEffect(() => {
    run.current++;
    setResult(null); setTranslations({}); setSaved(null); setError(""); setBusy(null);
  }, [selected?.text, selection?.sentenceIndex]);

  useEffect(() => {
    if (busy !== "explain") return setSlow(false);
    const t = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => { clearTimeout(t); setSlow(false); };
  }, [busy]);

  if (!items) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (!capture) {
    return (
      <>
        <PageHeader title="Explore" back={{ to: "/inbox", label: "Inbox" }} />
        <Alert><AlertDescription>This subtitle isn't in your Inbox anymore.</AlertDescription></Alert>
      </>
    );
  }

  const nativeLanguage = prefs?.nativeLanguage;
  const lang = nativeLanguage ? findLanguage(nativeLanguage) : null;
  const wantsTranslation = !!nativeLanguage && nativeLanguage !== "en" && !nativeLanguage.startsWith("en-");
  const translationHere = nativeLanguage ? translations[nativeLanguage] : undefined;

  async function onExplain() {
    if (!selected || !sentence) return;
    const my = ++run.current;
    setBusy("explain"); setError(""); setResult(null);
    try {
      const idx = selection!.sentenceIndex;
      const r = await explain({
        app,
        input: {
          selectedText: selected.text,
          selectionKind: selected.kind,
          sourceSentence: sentence,
          contextBefore: sentences[idx - 1],
          contextAfter: sentences[idx + 1],
        },
      });
      if (my !== run.current) return;
      setResult(r);
    } catch {
      if (my === run.current) setError("Couldn't create the card. Please try again.");
    } finally {
      if (my === run.current) setBusy(null);
    }
  }

  function cancel() {
    run.current++;
    setBusy(null);
  }

  async function onTranslate() {
    if (!result || !selected || !sentence || !nativeLanguage) return;
    const route = routeFor(nativeLanguage, support, promptApiPresent);
    if (route === "NONE") return;
    const my = run.current;
    setBusy("translate"); setError("");
    try {
      const t = await translateCard({
        app, languageCode: nativeLanguage, route,
        card: { selectedText: selected.text, selectionKind: selected.kind, category: result.content.category, sourceSentence: sentence, contextualMeaningEn: result.content.contextualMeaningEn, meaningEn: result.content.meaningEn },
      });
      if (my !== run.current) return;
      setTranslations((prev) => ({ ...prev, [nativeLanguage]: t }));
      if (saved) { const { addTranslation } = await import("@/data/cards"); await addTranslation(user.uid, saved.id, t); }
    } catch {
      if (my === run.current) setError(`Couldn't translate to ${lang?.name ?? "your language"}. Please try again.`);
    } finally {
      if (my === run.current) setBusy(null);
    }
  }

  async function onSave() {
    if (!result || !selected || !sentence) return;
    setBusy("save"); setError("");
    try {
      const r = await saveCard(user.uid, {
        selectedText: selected.text,
        selectionKind: selected.kind,
        selectionStart: selected.start,
        selectionEnd: selected.end,
        sourceSentence: sentence,
        english: result.content,
        englishSource: result.source,
        promptVersion: result.promptVersion,
        translations,
        source: { platform: capture!.platform, videoId: capture!.videoId, videoTitle: capture!.videoTitle, videoUrl: capture!.videoUrl, playbackTimeSeconds: capture!.playbackTimeSeconds, captureId: capture!.id },
      });
      setSaved(r);
    } catch {
      setError("Couldn't save the card. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function finishEdit() {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === text) return;
    setEdited(next); setSelection(null);
    try { await updateDoc(doc(db, "users", user.uid, "captures", capture!.id), { editedText: next.slice(0, 1000) }); } catch { /* the edit still applies on this screen */ }
  }

  const sentenceChosen = selection?.whole === true;

  return (
    <>
      <PageHeader title="Explore" back={{ to: "/inbox", label: "Inbox" }} subtitle="Select a word, a phrase, or the whole sentence." />

      <Card className="mb-4 rounded-2xl">
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {capture.videoTitle}
            {capture.videoUrl && <> · <a className="text-primary underline underline-offset-2" href={capture.videoUrl} target="_blank" rel="noreferrer noopener">{fmtTime(capture.playbackTimeSeconds)}</a></>}
          </p>
          {editing ? (
            <div className="space-y-2">
              <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} maxLength={1000} aria-label="Subtitle text" />
              <div className="flex gap-2">
                <Button size="sm" onClick={finishEdit}><Check className="size-4" /> Done</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <>
              <WordSelector sentences={sentences} selection={selection} onChange={setSelection} />
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                {sentences.length > 0 && (
                  <>
                    {sentences.map((s, i) => (
                      <Button key={i} size="sm" variant={selection?.whole && selection.sentenceIndex === i ? "default" : "outline"} onClick={() => setSelection({ sentenceIndex: i, from: 0, to: 0, whole: true })}>
                        {sentences.length > 1 ? `Sentence ${i + 1}` : "Whole sentence"}
                      </Button>
                    ))}
                  </>
                )}
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { setDraft(text); setEditing(true); }}><Pencil className="size-4" /> Edit text</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {selected && !result && (
        <Card className="mb-4 rounded-2xl border-primary/30">
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{sentenceChosen ? "Sentence" : selected.kind === "word" ? "Word" : "Phrase"}</p>
              <p className="truncate text-lg font-semibold">“{selected.text}”</p>
            </div>
            <div className="flex items-center gap-2">
              {busy === "explain" && <Button variant="ghost" onClick={cancel}>Cancel</Button>}
              <Button onClick={onExplain} disabled={busy === "explain"}>
                {busy === "explain" ? <><Loader2 className="size-4 animate-spin" /> Working…</> : "Explain"}
              </Button>
            </div>
            {busy === "explain" && slow && <p className="basis-full text-sm text-muted-foreground" role="status">This is taking longer than usual. You can wait or cancel and try again.</p>}
          </CardContent>
        </Card>
      )}

      {error && (
        <Alert role="alert" className="mb-4">
          <AlertDescription className="flex items-center justify-between gap-3">
            {error}
            <Button size="sm" variant="outline" onClick={result ? onTranslate : onExplain}><RotateCcw className="size-4" /> Try again</Button>
          </AlertDescription>
        </Alert>
      )}

      {result && selected && (
        <Card className="rounded-2xl">
          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-2xl font-bold">{selected.text}</h2>
                <div className="mt-2 flex items-center gap-2">
                  <Badge variant="secondary" className="font-normal">{CATEGORY_LABEL[result.content.category]}</Badge>
                  <SourceBadge source={result.source} />
                </div>
              </div>
            </div>

            <CardBody card={result.content} />

            {wantsTranslation && (
              <div className="space-y-2">
                {translationHere && nativeLanguage ? (
                  <TranslationView code={nativeLanguage} entry={translationHere} compareTo={result.source} />
                ) : (
                  <Button variant="outline" onClick={onTranslate} disabled={busy === "translate"}>
                    {busy === "translate" ? <Loader2 className="size-4 animate-spin" /> : <Languages className="size-4" />} Translate to {lang?.name}
                  </Button>
                )}
              </div>
            )}
            {!nativeLanguage && (
              <p className="text-sm text-muted-foreground">Want this in your own language? <Link className="text-primary underline underline-offset-2" to="/profile">Choose a language</Link>.</p>
            )}

            <OnDevicePrompt />

            <div className="flex flex-wrap items-center gap-3 border-t pt-4">
              {saved ? (
                <>
                  <Badge className="gap-1"><Check className="size-3" /> {saved.existed ? "Already in your collection" : "Saved"}</Badge>
                  <Button variant="link" className="h-auto p-0" onClick={() => navigate(`/collection/${saved.id}`)}>View card</Button>
                  <Button variant="link" className="h-auto p-0" onClick={() => setSelection(null)}>Pick another</Button>
                </>
              ) : (
                <Button onClick={onSave} disabled={busy === "save"}>{busy === "save" ? <Loader2 className="size-4 animate-spin" /> : null} Save to collection</Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
