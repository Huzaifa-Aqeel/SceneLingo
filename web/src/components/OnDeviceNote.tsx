import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Cpu } from "lucide-react";
import { useDeviceModel } from "@/ai/deviceModel";

const KEY = "sceneLingo.deviceNote.seen";
const seen = (): boolean => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
const markSeen = () => { try { localStorage.setItem(KEY, "1"); } catch { /* shown again next time, which is harmless */ } };

// A passing line under the first generated card, once per device, for a few seconds. No buttons.
// Shown only where the model could run (it is not installed yet), so it never promises what a device can't do.
export function OnDeviceNote() {
  const d = useDeviceModel();
  const [visible, setVisible] = useState(false);
  const eligible = d.phase === "can-download" || d.phase === "downloading";

  useEffect(() => {
    if (!eligible || seen()) return;
    markSeen(); // from now on never again, even if the page is reloaded
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 8000);
    return () => clearTimeout(t);
  }, [eligible]);

  if (!visible) return null;
  return (
    <p role="status" className="flex items-center gap-2 rounded-xl bg-secondary/60 px-4 py-3 text-sm">
      <Cpu className="size-4 shrink-0 text-primary" aria-hidden />
      <span>Cards and translations run on this computer: faster, private, and free. Visit the <Link to="/profile" className="text-primary underline underline-offset-2">Profile</Link> page.</span>
    </p>
  );
}
