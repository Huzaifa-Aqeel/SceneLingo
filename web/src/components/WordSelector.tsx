import { useRef } from "react";
import { cn } from "@/lib/utils";
import { wordsOf, type Selection } from "@/lib/text";

// Shows each sentence word by word. Click a word, drag across words, or click a first and then a last word.
// Words are real buttons, so the keyboard works too (Tab to a word, Enter to select).
export function WordSelector({ sentences, selection, onChange }: { sentences: string[]; selection: Selection | null; onChange: (s: Selection | null) => void }) {
  const drag = useRef<{ sentence: number; anchor: number } | null>(null);
  const moved = useRef(false); // true once a drag has extended the selection, so its final click is ignored

  const within = (si: number, wi: number) =>
    !!selection && !selection.whole && selection.sentenceIndex === si && wi >= Math.min(selection.from, selection.to) && wi <= Math.max(selection.from, selection.to);

  function pick(si: number, wi: number) {
    // A second pick in the same sentence extends the first; anywhere else starts over.
    if (selection && !selection.whole && selection.sentenceIndex === si && selection.from === selection.to && selection.from !== wi) {
      onChange({ sentenceIndex: si, from: Math.min(selection.from, wi), to: Math.max(selection.from, wi), whole: false });
    } else if (selection && !selection.whole && selection.sentenceIndex === si && selection.from === selection.to && selection.from === wi) {
      onChange(null);
    } else {
      onChange({ sentenceIndex: si, from: wi, to: wi, whole: false });
    }
  }

  return (
    <div className="space-y-4" onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}>
      {sentences.map((sentence, si) => {
        const words = wordsOf(sentence);
        const parts: { key: string; text: string; word: number | null }[] = [];
        let cursor = 0;
        words.forEach((w, wi) => {
          if (w.start > cursor) parts.push({ key: `g${cursor}`, text: sentence.slice(cursor, w.start), word: null });
          parts.push({ key: `w${w.start}`, text: sentence.slice(w.start, w.end), word: wi });
          cursor = w.end;
        });
        if (cursor < sentence.length) parts.push({ key: `g${cursor}`, text: sentence.slice(cursor), word: null });

        return (
          <p key={si} className="flex flex-wrap items-baseline text-xl leading-10" lang="en">
            {parts.map((p) =>
              p.word === null ? (
                <span key={p.key} className="whitespace-pre-wrap">{p.text}</span>
              ) : (
                <button
                  key={p.key}
                  type="button"
                  aria-pressed={within(si, p.word) || (!!selection?.whole && selection.sentenceIndex === si)}
                  className={cn(
                    "rounded-md px-0.5 transition-colors hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-ring",
                    (within(si, p.word) || (selection?.whole && selection.sentenceIndex === si)) && "bg-primary/20 font-semibold underline decoration-primary decoration-2 underline-offset-4"
                  )}
                  onPointerDown={(e) => { if (e.pointerType === "mouse") { drag.current = { sentence: si, anchor: p.word! }; moved.current = false; } }}
                  onPointerEnter={() => {
                    const d = drag.current;
                    if (d && d.sentence === si && d.anchor !== p.word) {
                      moved.current = true;
                      onChange({ sentenceIndex: si, from: Math.min(d.anchor, p.word!), to: Math.max(d.anchor, p.word!), whole: false });
                    }
                  }}
                  onClick={() => {
                    if (moved.current) { moved.current = false; return; }
                    pick(si, p.word!);
                  }}
                >
                  {p.text}
                </button>
              )
            )}
          </p>
        );
      })}
    </div>
  );
}
