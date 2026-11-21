import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDeviceModel } from "@/ai/deviceModel";

// Profile: the one place where the on-device model is set up and its download is followed. Hidden on browsers
// and devices that can't run it. The states, in order: Download, Starting…, Downloading… 40%, a quiet note when
// it takes long, Ready, or the reason it failed.
export default function OnDeviceCard() {
  const d = useDeviceModel();
  if (d.phase === "checking" || d.phase === "none") return null;
  const percent = d.progress && d.progress > 0 ? ` ${Math.round(d.progress * 100)}%` : "";
  const watching = d.phase === "downloading" && d.ours && !d.stalled; // we started it and it is still moving (or just starting)
  return (
    <Card id="on-device">
      <CardHeader>
        <CardTitle>On-device model</CardTitle>
        <CardDescription>Cards and translations run on this computer: faster, private, and free. It needs a download of several GB, 22 GB of free space, and an unmetered connection.</CardDescription>
      </CardHeader>
      <CardContent>
        {d.phase === "ready" && <p>Ready. Cards use it whenever they can.</p>}
        {watching && <p role="status" className="flex items-center gap-2"><Loader2 className="size-4 animate-spin text-primary" aria-hidden />{percent ? `Downloading…${percent}` : "Starting…"}</p>}
        {d.phase === "downloading" && !watching && <p role="status">Chrome is downloading the model in the background.</p>}
        {d.phase === "can-download" && (
          <div className="space-y-2">
            {d.failed && <p role="alert" className="text-sm text-muted-foreground">The download didn't finish.{d.error ? ` Chrome said: ${d.error}` : ""}</p>}
            <Button onClick={d.start}>{d.failed ? "Try again" : "Download"}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
