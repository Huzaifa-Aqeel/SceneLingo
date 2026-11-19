import { Cloud, Cpu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { InferenceSource } from "@/lib/schemas";

// Always states where the answer was produced, in words (never colour alone).
export function SourceBadge({ source }: { source?: InferenceSource | null }) {
  if (!source) return null;
  const device = source === "ON_DEVICE";
  return (
    <Badge variant="secondary" className="gap-1 font-normal">
      {device ? <Cpu className="size-3" aria-hidden /> : <Cloud className="size-3" aria-hidden />}
      {device ? "On your device" : "Cloud"}
    </Badge>
  );
}
