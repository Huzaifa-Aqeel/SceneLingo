import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDeviceModel } from "@/ai/deviceModel";

// Profile: where a learner who said "Not now" can download the on-device model later. Hidden on browsers and
// devices that can't run it.
export default function OnDeviceCard() {
  const d = useDeviceModel();
  if (d.phase === "checking" || d.phase === "none") return null;
  return (
    <Card id="on-device">
      <CardHeader>
        <CardTitle>On-device model</CardTitle>
        <CardDescription>Cards and translations run on this computer: faster, private, and free. It needs a download of several GB.</CardDescription>
      </CardHeader>
      <CardContent>
        {d.phase === "ready" && <p>Ready. Cards use it whenever they can.</p>}
        {d.phase === "downloading" && <p role="status" className="flex items-center gap-2"><Loader2 className="size-4 animate-spin text-primary" aria-hidden /> Downloading…{d.progress === null ? "" : ` ${Math.round(d.progress * 100)}%`}</p>}
        {d.phase === "can-download" && (
          <div className="space-y-2">
            {d.failed && <p className="text-sm text-muted-foreground">The last download didn't finish.</p>}
            <Button onClick={d.start}>{d.failed ? "Try again" : "Download"}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
