import { useEffect, useState } from "react";
import { LANGUAGES } from "@/languages";
import { hasPromptApi, probeLanguages, type LanguageModelLike, type SupportMap } from "./support";

// Probes the Prompt API once per page session. The availability check needs no user gesture;
// starting a model download does, and that never happens here.
let cached: SupportMap | null = null;

export function useLanguageSupport() {
  const present = hasPromptApi();
  const [support, setSupport] = useState<SupportMap | null>(cached);
  useEffect(() => {
    if (!present || cached) return;
    let live = true;
    const codes = LANGUAGES.map((l) => l.code).filter((c) => c !== "en");
    const LM = (globalThis as unknown as { LanguageModel: LanguageModelLike }).LanguageModel;
    probeLanguages(LM, codes).then((s) => {
      cached = s;
      if (live) setSupport(s);
    });
    return () => { live = false; };
  }, [present]);
  return { support, promptApiPresent: present, probing: present && !support };
}
