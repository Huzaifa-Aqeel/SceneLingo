import type { ReactNode } from "react";

// A card that flips between two faces. Click it, or press Space or Enter.
export function FlipCard({ flipped, onFlip, front, back }: { flipped: boolean; onFlip: () => void; front: ReactNode; back: ReactNode }) {
  return (
    <div className="flip-scene">
      <div
        role="button"
        tabIndex={0}
        aria-label={flipped ? "Show the term" : "Show the answer"}
        onClick={onFlip}
        onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === " " || e.key === "Enter")) { e.preventDefault(); onFlip(); } }}
        data-flipped={flipped}
        className="flip-card relative grid min-h-[22rem] w-full cursor-pointer select-none rounded-3xl shadow-[0_2px_16px_-4px_rgb(0_0_0/0.15)] outline-none focus-visible:ring-4 focus-visible:ring-ring/40"
      >
        <div aria-hidden={flipped} className="flip-face col-start-1 row-start-1 grid place-items-center rounded-3xl bg-card p-8 text-center">{front}</div>
        <div aria-hidden={!flipped} className="flip-face flip-back col-start-1 row-start-1 grid place-items-center overflow-auto rounded-3xl bg-card p-8 text-center">{back}</div>
      </div>
    </div>
  );
}
