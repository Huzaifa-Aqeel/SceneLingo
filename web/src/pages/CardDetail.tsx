import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { User } from "firebase/auth";
import { Languages, Loader2, Trash2 } from "lucide-react";
import { app } from "@/firebase";
import { translateCard } from "@/ai/translate";
import { routeFor } from "@/ai/support";
import { useLanguageSupport } from "@/ai/useSupport";
import { CardBody } from "@/components/CardBody";
import { PageHeader } from "@/components/PageHeader";
import { SourceBadge } from "@/components/SourceBadge";
import { TranslationView } from "@/components/TranslationView";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { addTranslation, deleteCard } from "@/data/cards";
import { useCards } from "@/hooks/useCards";
import { usePreferences } from "@/hooks/usePreferences";
import { findLanguage, translationKey } from "@/languages";
import { fmtTime } from "@/lib/format";
import { CATEGORY_LABEL } from "@/lib/schemas";

export default function CardDetail({ user }: { user: User }) {
  const { cardId } = useParams();
  const navigate = useNavigate();
  const { cards } = useCards(user.uid);
  const { prefs } = usePreferences(user.uid);
  const { support, promptApiPresent } = useLanguageSupport();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!cards) return <Skeleton className="h-72 w-full rounded-2xl" />;
  const card = cards.find((c) => c.id === cardId);
  if (!card) {
    return (<><PageHeader title="Card" back={{ to: "/collection", label: "My Collection" }} /><Alert><AlertDescription>This card isn't in your collection.</AlertDescription></Alert></>);
  }

  const code = prefs?.nativeLanguage;
  const lang = code ? findLanguage(code) : null;
  const wants = !!code && code !== "en" && !code.startsWith("en-");
  const has = code ? card.translations[translationKey(code)] : undefined;

  async function onTranslate() {
    if (!code || !card) return;
    const route = routeFor(code, support, promptApiPresent);
    if (route === "NONE") return;
    setBusy(true); setError("");
    try {
      const t = await translateCard({ app, languageCode: code, route, card: { selectedText: card.selectedText, selectionKind: card.selectionKind, category: card.category, sourceSentence: card.sourceSentence, contextualMeaningEn: card.contextualMeaningEn, meaningEn: card.meaningEn } });
      await addTranslation(user.uid, card.id, t);
    } catch {
      setError(`Couldn't translate to ${lang?.name ?? "your language"}. Please try again.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Card" back={{ to: "/collection", label: "My Collection" }} />
      <Card className="rounded-2xl">
        <CardContent className="space-y-5">
          <div>
            <h2 className="text-2xl font-bold">{card.selectedText}</h2>
            <div className="mt-2 flex items-center gap-2">
              <Badge variant="secondary" className="font-normal">{CATEGORY_LABEL[card.category]}</Badge>
              <SourceBadge source={card.ai.englishInferenceSource} />
            </div>
          </div>

          <div className="rounded-xl bg-secondary/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">From the subtitle</p>
            <p className="mt-1 text-lg">“{card.sourceSentence}”</p>
            {card.source.videoTitle && (
              <p className="mt-1 text-sm text-muted-foreground">
                {card.source.videoTitle}
                {card.source.videoUrl && <> · <a className="text-primary underline underline-offset-2" href={card.source.videoUrl} target="_blank" rel="noreferrer noopener">{fmtTime(card.source.playbackTimeSeconds)}</a></>}
              </p>
            )}
          </div>

          <CardBody card={card} />

          {Object.entries(card.translations).map(([k, t]) => <TranslationView key={k} code={k} entry={t} compareTo={card.ai.englishInferenceSource} />)}
          {wants && !has && (
            <Button variant="outline" onClick={onTranslate} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Languages className="size-4" />} Translate to {lang?.name}
            </Button>
          )}
          {!code && <p className="text-sm text-muted-foreground">Want translations? <Link className="text-primary underline underline-offset-2" to="/profile">Choose your language</Link>.</p>}
          {error && <Alert role="alert"><AlertDescription>{error}</AlertDescription></Alert>}

          <div className="flex items-center justify-between border-t pt-4">
            <p className="text-sm text-muted-foreground">
              {card.review.attemptCount > 0 ? `Reviewed ${card.review.attemptCount} ${card.review.attemptCount === 1 ? "time" : "times"}` : "Not practised yet"}
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild><Button variant="ghost" className="text-destructive hover:text-destructive"><Trash2 className="size-4" /> Delete</Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this card?</AlertDialogTitle>
                  <AlertDialogDescription>“{card.selectedText}” will be removed from your collection. Your practice history stays.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep it</AlertDialogCancel>
                  <AlertDialogAction onClick={async () => { await deleteCard(user.uid, card.id); navigate("/collection"); }}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
