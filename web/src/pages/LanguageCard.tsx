import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LANGUAGES, findLanguage, type Language } from "@/languages";
import { routeFor, whereItRuns } from "@/ai/support";
import { useLanguageSupport } from "@/ai/useSupport";
import { usePreferences } from "@/hooks/usePreferences";

// Picks the language translations are written in. Each option says where it runs on THIS browser.
export default function LanguageCard({ uid }: { uid: string }) {
  const { prefs, save } = usePreferences(uid);
  const { support, promptApiPresent, probing } = useLanguageSupport();
  const [saved, setSaved] = useState(false);
  if (prefs === undefined) return null;

  const current = prefs.nativeLanguage || "";
  const lang = current ? findLanguage(current) : null;
  const route = current ? routeFor(current, support, promptApiPresent) : "NONE";

  const where = (l: Language) => {
    if (l.code === "en") return "";
    return probing ? "checking…" : whereItRuns(routeFor(l.code, support, promptApiPresent));
  };

  async function choose(code: string) {
    await save({ nativeLanguage: code });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <Card id="language">
      <CardHeader>
        <CardTitle>Translation language</CardTitle>
        <CardDescription>
          Cards are explained in English, and can be translated into your language.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-1.5">
          <Label htmlFor="language-select">My language</Label>
          <Select value={current || undefined} onValueChange={choose}>
            <SelectTrigger id="language-select" aria-describedby="language-help" className="w-full">
              <SelectValue placeholder="Choose your language…" />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              {LANGUAGES.map((l) => (
                <SelectItem key={l.code} value={l.code}>
                  {l.name}{l.native !== l.name ? ` · ${l.native}` : ""}{where(l) ? ` — ${where(l)}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p id="language-help" className="text-sm text-muted-foreground" aria-live="polite">
          {saved && "Saved. "}
          {lang && route === "PREFER_ON_DEVICE" && `${lang.name} is translated on this device.`}
          {lang && route === "ONLY_IN_CLOUD" && `${lang.name} is translated in the cloud.`}
          {lang && route === "NONE" && "No translation needed."}
        </p>
      </CardContent>
    </Card>
  );
}
