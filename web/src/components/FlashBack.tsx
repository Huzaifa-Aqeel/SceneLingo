import { ExternalLink } from "lucide-react";
import { TranslationView } from "@/components/TranslationView";
import { Badge } from "@/components/ui/badge";
import { fmtTime } from "@/lib/format";
import { CATEGORY_LABEL, type LearningCard, type TranslationEntry } from "@/lib/schemas";
import { blankOut } from "@/lib/text";

const Label = ({ children }: { children: string }) => <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>;

// The answer side of a flashcard: everything the learner saved about the card, on one face.
export function FlashBack({ card, translation, showTerm }: { card: LearningCard; translation?: { code: string; entry: TranslationEntry } | null; showTerm?: boolean }) {
  const parts = blankOut(card.sourceSentence, card.selectedText);
  return (
    <div className="w-full space-y-4 text-left">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="font-normal">{CATEGORY_LABEL[card.category]}</Badge>
        {card.partOfSpeech && <span className="text-sm italic text-muted-foreground">{card.partOfSpeech}</span>}
      </div>
      <div>
        {showTerm && <p className="mb-1 text-3xl font-semibold">{card.selectedText}</p>}
        <p className="text-xl font-medium">{card.meaningEn}</p>
        <p className="mt-1 text-muted-foreground">{card.contextualMeaningEn}</p>
      </div>
      {translation && <TranslationView code={translation.code} entry={translation.entry} hideSource />}
      {card.synonyms.length > 0 && (
        <div>
          <Label>Similar</Label>
          <div className="flex flex-wrap gap-1.5">{card.synonyms.map((s) => <Badge key={s} variant="outline" className="font-normal">{s}</Badge>)}</div>
        </div>
      )}
      {card.exampleSentences.length > 0 && (
        <div>
          <Label>Examples</Label>
          <ul className="space-y-1">{card.exampleSentences.map((e) => <li key={e} className="border-l-2 border-primary/40 pl-3">{e}</li>)}</ul>
        </div>
      )}
      {card.sourceSentence && (
        <div className="rounded-xl bg-secondary/60 p-3">
          <Label>From the scene</Label>
          <p>“{parts ? <>{parts.before}<strong>{parts.match}</strong>{parts.after}</> : card.sourceSentence}”</p>
          {card.source.videoTitle && (
            <p className="mt-1 text-sm text-muted-foreground">
              {card.source.videoTitle}
              {card.source.videoUrl && (
                <> · <a className="inline-flex items-center gap-1 text-primary underline underline-offset-2" href={card.source.videoUrl} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>Watch at {fmtTime(card.source.playbackTimeSeconds)}<ExternalLink className="size-3" aria-hidden /></a></>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
