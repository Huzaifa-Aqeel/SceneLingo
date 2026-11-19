import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/firebase";
import { parseCapture, type Capture } from "@/lib/schemas";

// Real-time capture list straight from Firestore. No dependency on the extension.
export function useCaptures(uid: string) {
  const [items, setItems] = useState<Capture[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const q = query(collection(db, "users", uid, "captures"), orderBy("capturedAt", "desc"), limit(300));
    return onSnapshot(
      q,
      (snap) => setItems(snap.docs.map((d) => parseCapture(d.id, d.data())).filter((c): c is Capture => c !== null)),
      () => setError("Couldn't load your captures. Check your connection and try again.")
    );
  }, [uid]);
  return { items, error };
}
