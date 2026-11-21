import { useEffect, useState } from "react";
import { Check, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDeviceModel } from "@/ai/deviceModel";

// Shows `active` for a few seconds and then lets it go.
function useFlash(active: boolean, ms: number) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!active) return;
    setOn(true);
    const t = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(t);
  }, [active, ms]);
  return on;
}

// One quiet line under the first generated card. It asks once, on a computer that could run the model but
// doesn't have it yet. Progress is not shown here (that lives in Profile), so Explore never carries a spinner.
export function OnDevicePrompt() {
  const d = useDeviceModel();
  const [note, setNote] = useState(false);
  const ready = useFlash(d.justReady, 8000);
  const line = "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-secondary/60 px-4 py-3 text-sm";

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(false), 6000);
    return () => clearTimeout(t);
  }, [note]);

  if (note) return <p role="status" className={line}><Cpu className="size-4 text-primary" aria-hidden /> Downloading in the background. Cards keep working in the cloud. You can follow it in Profile.</p>;
  if (ready) return <p role="status" className={line}><Check className="size-4 text-success" aria-hidden /> The on-device model is ready. Your next cards will run on this device.</p>;
  if (d.phase !== "can-download" || d.declined) return null;
  return (
    <div className={line}>
      <Cpu className="size-4 text-primary" aria-hidden />
      <p className="min-w-0 flex-1">{d.failed ? "The download didn't finish." : "Make cards faster and private on this device?"} <span className="text-muted-foreground">Download the on-device model (several GB).</span></p>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => { d.start(); setNote(true); }}>{d.failed ? "Try again" : "Download"}</Button>
        <Button size="sm" variant="ghost" onClick={d.decline}>Not now</Button>
      </div>
    </div>
  );
}
