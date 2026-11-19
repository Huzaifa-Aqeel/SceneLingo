import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import type { User } from "firebase/auth";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { discardLines, getNeedsAttention, pingExtension, pushSession } from "@/extension";
import { canInstallExtension, EXTENSION_ZIP } from "@/lib/browser";
import type { NeedsAttention } from "@/lib/schemas";
import LanguageCard from "./LanguageCard";

export default function Profile({ user, onLogOut }: { user: User; onLogOut: () => void }) {
  const [params] = useSearchParams();
  // checking | ready (extension is signed in as this account) | notSignedIn (installed, but not signed in) | missing
  const [link, setLink] = useState<"checking" | "ready" | "notSignedIn" | "missing">("checking");
  const [attn, setAttn] = useState<NeedsAttention | null>(null);

  async function refresh() {
    let ping = await pingExtension();
    if (ping.ok && (ping.signedInUid !== user.uid || ping.authState !== "ok")) {
      await pushSession(user); // hand the session over again, then look once more
      ping = await pingExtension();
    }
    setLink(!ping.ok ? "missing" : ping.signedInUid === user.uid && ping.authState === "ok" ? "ready" : "notSignedIn");
    const a = await getNeedsAttention();
    setAttn(a.ok ? a : null);
  }
  useEffect(() => { void refresh(); }, []);
  // Coming back from installing the extension: look again without making the learner press anything.
  useEffect(() => {
    const again = () => { if (document.visibilityState === "visible" && link !== "ready") void refresh(); };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    return () => { document.removeEventListener("visibilitychange", again); window.removeEventListener("focus", again); };
  }, [link]);
  useEffect(() => {
    if (attn && params.get("attention")) document.getElementById("attention")?.scrollIntoView();
  }, [attn, params]);

  async function remove(ids: string[]) {
    if (!confirm("Remove these for good?")) return;
    await discardLines(ids);
    await refresh();
  }

  const show = attn && (attn.own.length > 0 || attn.other.length > 0);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Profile</h1>
      <Card>
        <CardHeader><CardTitle>Account</CardTitle></CardHeader>
        <CardContent className="space-y-3"><p>{user.email}</p><Button variant="outline" onClick={onLogOut}>Sign out</Button></CardContent>
      </Card>
      <LanguageCard uid={user.uid} />
      <Card>
        <CardHeader><CardTitle>Extension</CardTitle></CardHeader>
        <CardContent>
          {link === "checking" && <p className="text-muted-foreground">Checking…</p>}
          {link === "ready" && <p>Connected and signed in.</p>}
          {link === "notSignedIn" && <p className="text-muted-foreground">Installed, but not signed in yet.</p>}
          {link === "missing" && <p className="text-muted-foreground">Not connected in this browser.</p>}
          {link === "missing" && (canInstallExtension() ? (
            <div className="mt-4 space-y-3">
              <Button asChild><a href={EXTENSION_ZIP} download="scenelingo-extension.zip"><Download className="size-4" /> Download extension</a></Button>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm">
                <li>Unzip the downloaded file.</li>
                <li>Open <code className="rounded bg-secondary px-1.5 py-0.5">chrome://extensions</code> and turn on Developer mode.</li>
                <li>Click Load unpacked and choose the unzipped folder.</li>
                <li>Return to this page.</li>
              </ol>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">The extension works in Chrome, Edge and Brave on a computer.</p>
          ))}
          {(link === "notSignedIn" || link === "missing") && <Button variant="outline" size="sm" className="mt-3" onClick={() => { setLink("checking"); void refresh(); }}>Check again</Button>}
        </CardContent>
      </Card>
      {show && (
        <Card id="attention">
          <CardHeader><CardTitle>Subtitles that couldn't be saved</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {attn.own.length > 0 && (
              <div className="space-y-2">
                <p className="text-muted-foreground">These subtitles couldn't be saved to your account.</p>
                <ul className="list-disc pl-5">{attn.own.map((l) => <li key={l.id}>“{l.text}” <span className="text-muted-foreground">· {l.videoTitle}</span></li>)}</ul>
                <Button variant="outline" onClick={() => remove(attn.own.map((l) => l.id))}>Remove</Button>
              </div>
            )}
            {attn.other.map((g) => (
              <div key={g.accountHint} className="space-y-2">
                <p className="text-muted-foreground">These lines belong to {g.accountHint} and will be saved when that account signs in.</p>
                <ul className="list-disc pl-5">{g.lines.map((l) => <li key={l.id}>“{l.text}”</li>)}</ul>
                <Button variant="outline" onClick={() => remove(g.lines.map((l) => l.id))}>Remove</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
