import { Check, Cpu, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDeviceModel } from "@/ai/deviceModel";

const pct = (p: number | null) => (p === null ? "" : ` ${Math.round(p * 100)}%`);

// One quiet line under the first generated card. It appears only on a computer that could run the model but
// doesn't have it yet, and only until the learner answers.
export function OnDevicePrompt() {
  const d = useDeviceModel();
  const line = "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-secondary/60 px-4 py-3 text-sm";

  if (d.phase === "downloading") {
    return <p role="status" className={line}><Loader2 className="size-4 animate-spin text-primary" aria-hidden /> Downloading the on-device model…{pct(d.progress)} <span className="text-muted-foreground">Cards keep working in the cloud meanwhile.</span></p>;
  }
  if (d.justReady) {
    return <p role="status" className={line}><Check className="size-4 text-success" aria-hidden /> The on-device model is ready. Your next cards will run on this device.</p>;
  }
  if (d.phase !== "can-download" || d.declined) return null;
  return (
    <div className={line}>
      <Cpu className="size-4 text-primary" aria-hidden />
      <p className="min-w-0 flex-1">{d.failed ? "The download didn't finish." : "Make cards faster and private on this device?"} <span className="text-muted-foreground">Download the on-device model (several GB).</span></p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={d.start}>{d.failed ? "Try again" : "Download"}</Button>
        <Button size="sm" variant="ghost" onClick={d.decline}>Not now</Button>
      </div>
    </div>
  );
}
