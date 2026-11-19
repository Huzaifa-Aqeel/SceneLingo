import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/firebase";
import { parseCard, parseEvent, type LearningCard, type ReviewEvent } from "@/lib/schemas";

export function useCards(uid: string) {
  const [cards, setCards] = useState<LearningCard[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const q = query(collection(db, "users", uid, "learningCards"), orderBy("createdAt", "desc"));
    return onSnapshot(
      q,
      (snap) => setCards(snap.docs.map((d) => parseCard(d.id, d.data())).filter((c): c is LearningCard => c !== null)),
      () => setError("Couldn't load your cards. Check your connection and try again.")
    );
  }, [uid]);
  return { cards, error };
}

export function useReviewEvents(uid: string) {
  const [events, setEvents] = useState<ReviewEvent[] | null>(null);
  useEffect(() => {
    const q = query(collection(db, "users", uid, "reviewEvents"), orderBy("reviewedAt", "desc"));
    return onSnapshot(q, (snap) => setEvents(snap.docs.map((d) => parseEvent(d.id, d.data())).filter((e): e is ReviewEvent => e !== null)), () => setEvents([]));
  }, [uid]);
  return events;
}
