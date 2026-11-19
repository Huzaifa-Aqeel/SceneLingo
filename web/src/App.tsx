import { useEffect, useState } from "react";
import { BrowserRouter, NavLink, Navigate, Route, Routes, useNavigate } from "react-router";
import { onIdTokenChanged, signOut, type User } from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "@/firebase";
import { clearExtensionSession, pingExtension, pushSession } from "@/extension";
import { BarChart3, Home as HomeIcon, Inbox as InboxIcon, Layers, Library, User as UserIcon, type LucideIcon } from "lucide-react";
import { useCaptures } from "@/hooks/useCaptures";
import { cn } from "@/lib/utils";
import SignIn from "@/pages/SignIn";
import Home from "@/pages/Home";
import Inbox from "@/pages/Inbox";
import Explore from "@/pages/Explore";
import Collection from "@/pages/Collection";
import CardDetail from "@/pages/CardDetail";
import Practice from "@/pages/Practice";
import Flashcards from "@/pages/Flashcards";
import Quiz from "@/pages/Quiz";
import Progress from "@/pages/Progress";
import Profile from "@/pages/Profile";

const NAV: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: "/", label: "Home", icon: HomeIcon, end: true },
  { to: "/inbox", label: "Inbox", icon: InboxIcon },
  { to: "/collection", label: "Collection", icon: Library },
  { to: "/practice", label: "Practice", icon: Layers },
  { to: "/progress", label: "Progress", icon: BarChart3 },
  { to: "/profile", label: "Profile", icon: UserIcon },
];

function Shell({ user }: { user: User }) {
  const navigate = useNavigate();
  const { items } = useCaptures(user.uid);
  const fresh = items?.filter((c) => c.status === "new").length ?? 0;

  async function logOut() {
    const r = await clearExtensionSession(); // the extension saves what it can, then forgets this account
    if (r.ok && r.unsaved) sessionStorage.setItem("sceneLingoUnsaved", "1");
    await signOut(auth);
    navigate("/");
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[15rem_1fr]">
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-10 flex justify-around border-t bg-card p-1 md:sticky md:top-0 md:h-screen md:flex-col md:justify-start md:gap-1 md:border-r md:border-t-0 md:p-3">
        <div className="hidden px-3 pb-4 pt-2 text-xl font-extrabold tracking-tight text-primary md:block">SceneLingo</div>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => cn("relative flex flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[11px] md:flex-row md:gap-3 md:px-3 md:py-2.5 md:text-sm md:font-medium", isActive ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}
          >
            <n.icon className="size-5" aria-hidden />
            {n.label}
            {n.to === "/inbox" && fresh > 0 && <span aria-label={`${fresh} new`} className="absolute right-3 top-1 rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground md:static md:ml-auto md:text-xs">{fresh > 99 ? "99+" : fresh}</span>}
          </NavLink>
        ))}
      </nav>
      <main className="mx-auto w-full max-w-3xl p-4 pb-24 md:p-8">
        <Routes>
          <Route path="/" element={<Home user={user} />} />
          <Route path="/inbox" element={<Inbox user={user} />} />
          <Route path="/explore/:captureId" element={<Explore user={user} />} />
          <Route path="/collection" element={<Collection user={user} />} />
          <Route path="/collection/:cardId" element={<CardDetail user={user} />} />
          <Route path="/practice" element={<Practice user={user} />} />
          <Route path="/practice/flashcards" element={<Flashcards user={user} />} />
          <Route path="/practice/quiz" element={<Quiz user={user} />} />
          <Route path="/progress" element={<Progress user={user} />} />
          <Route path="/profile" element={<Profile user={user} onLogOut={logOut} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined); // undefined = still loading

  useEffect(
    () =>
      onIdTokenChanged(auth, async (u) => {
        setUser(u);
        if (!u) return;
        void pushSession(u); // keep the extension signed in as the same account
        try {
          const ref = doc(db, "users", u.uid);
          if (!(await getDoc(ref)).exists()) {
            await setDoc(ref, { email: u.email, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
          }
        } catch {
          // profile creation is retried on the next sign-in; not critical here
        }
      }),
    []
  );

  // Keep the extension on this account. Covers installing the extension while this page is already
  // open, a browser restart, and a session the extension had to drop. Cheap: the ping is local to the extension.
  useEffect(() => {
    if (!user) return;
    const sync = async () => {
      if (document.visibilityState !== "visible") return;
      const p = await pingExtension();
      if (p.ok && (p.signedInUid !== user.uid || p.authState !== "ok")) void pushSession(user);
    };
    void sync();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
    };
  }, [user]);

  if (user === undefined) return <div className="grid min-h-screen place-items-center text-muted-foreground">Loading…</div>;
  return <BrowserRouter>{user ? <Shell user={user} /> : <SignIn />}</BrowserRouter>;
}
