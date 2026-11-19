import { Badge } from "@/components/ui/badge";
import type { EnglishCardContent } from "@/lib/schemas";

type Body = Pick<EnglishCardContent, "meaningEn" | "contextualMeaningEn" | "synonyms" | "exampleSentences"> & { partOfSpeech?: string | null; usageNote?: string | null; confidenceNote?: string | null };

const Label = ({ children }: { children: string }) => <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>;

// The English side of a learning card. Shared by Explore and the card page.
export function CardBody({ card }: { card: Body }) {
  return (
    <div className="space-y-4">
      <div>
        <Label>Meaning</Label>
        <p className="text-lg">{card.meaningEn}{card.partOfSpeech && <span className="ml-2 text-sm italic text-muted-foreground">{card.partOfSpeech}</span>}</p>
      </div>
      <div>
        <Label>In context</Label>
        <p>{card.contextualMeaningEn}</p>
        {card.confidenceNote && <p className="mt-1 text-sm italic text-muted-foreground">{card.confidenceNote}</p>}
      </div>
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
      {card.usageNote && (
        <div>
          <Label>Usage</Label>
          <p className="text-sm text-muted-foreground">{card.usageNote}</p>
        </div>
      )}
    </div>
  );
}
