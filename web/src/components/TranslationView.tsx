import { findLanguage, directionOf } from "@/languages";
import type { InferenceSource, TranslationEntry } from "@/lib/schemas";
import { SourceBadge } from "./SourceBadge";

// One translation, rendered in its own language's direction and script.
export function TranslationView({ code, entry, compareTo, hideSource }: { code: string; entry: Pick<TranslationEntry, "translation" | "explanation" | "literalMeaningNote" | "inferenceSource">; compareTo?: InferenceSource | null; hideSource?: boolean }) {
  const lang = findLanguage(code.replace("_", "-"));
  const dir = directionOf(code.replace("_", "-"));
  return (
    <div className="space-y-1.5 rounded-xl bg-secondary/60 p-4">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{lang?.name ?? code}</span>
        {!hideSource && entry.inferenceSource !== compareTo && <SourceBadge source={entry.inferenceSource} />}
      </div>
      <div dir={dir} lang={code.replace("_", "-")} className="space-y-1.5">
        <p className="text-lg font-medium">{entry.translation}</p>
        {entry.explanation && <p>{entry.explanation}</p>}
        {entry.literalMeaningNote && <p className="text-sm text-muted-foreground">{entry.literalMeaningNote}</p>}
      </div>
    </div>
  );
}
