import { useEffect, useState } from "react";
import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/firebase";

export interface Preferences {
  nativeLanguage?: string;
}

const prefsRef = (uid: string) => doc(db, "users", uid, "settings", "preferences");

export function usePreferences(uid: string) {
  const [prefs, setPrefs] = useState<Preferences | undefined>(undefined); // undefined = loading
  useEffect(
    () => onSnapshot(prefsRef(uid), (s) => setPrefs(s.exists() ? (s.data() as Preferences) : {}), () => setPrefs({})),
    [uid]
  );
  const save = (patch: Partial<Preferences>) => setDoc(prefsRef(uid), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
  return { prefs, save };
}
