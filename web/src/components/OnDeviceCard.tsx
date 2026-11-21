import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDeviceModel } from "@/ai/deviceModel";

// Profile: the one place where the on-device model is managed and its download is followed. Hidden on browsers
// and devices that can't run it.
export default function OnDeviceCard() {
  const d = useDeviceModel();
  if (d.phase === "checking" || d.phase === "none") return null;
  const percent = d.progress && d.progress > 0 ? ` ${Math.round(d.progress * 100)}%` : "";
  return (
    <Card id="on-device">
      <CardHeader>
        <CardTitle>On-device model</CardTitle>
        <CardDescription>Cards and translations run on this computer: faster, private, and free. It needs a download of several GB, 22 GB of free space, and an unmetered connection.</CardDescription>
      </CardHeader>
      <CardContent>
        {d.phase === "ready" && <p>Ready. Cards use it whenever they can.</p>}

        {d.phase === "downloading" && d.ours && !d.stalled && (
          <p role="status" className="flex items-center gap-2"><Loader2 className="size-4 animate-spin text-primary" aria-hidden />{percent ? `Downloading…${percent}` : "Starting…"}</p>
        )}
        {d.phase === "downloading" && d.ours && d.stalled && (
          <div role="status" className="space-y-2">
            <p>Still downloading in the background.</p>
            <p className="text-sm text-muted-foreground">This can take a while, and it needs enough free space and an unmetered connection. To stop it, open Chrome Settings, then System, then turn off On-device AI.</p>
            <Button variant="outline" size="sm" onClick={() => void d.recheck()}>Check again</Button>
          </div>
        )}
        {d.phase === "downloading" && !d.ours && (
          <div role="status" className="space-y-2">
            <p>Chrome is downloading the model in the background.</p>
            <Button variant="outline" size="sm" onClick={() => void d.recheck()}>Check again</Button>
          </div>
        )}

        {d.phase === "can-download" && (
          <div className="space-y-2">
            {d.failed && <p className="text-sm text-muted-foreground">The download didn't finish.</p>}
            <Button onClick={d.start}>{d.failed ? "Try again" : "Download"}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
