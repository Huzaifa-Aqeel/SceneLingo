import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/firebase";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const AUTH_MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "Wrong email or password.",
  "auth/invalid-email": "That email address doesn't look right.",
  "auth/email-already-in-use": "An account with that email already exists. Try signing in.",
  "auth/weak-password": "Please choose a password with at least 6 characters.",
  "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
  "auth/network-request-failed": "No internet connection.",
  "auth/user-disabled": "This account has been disabled.",
};
const message = (err: unknown, fallback: string) => AUTH_MESSAGES[(err as { code?: string }).code ?? ""] ?? fallback;

export default function SignIn() {
  const [params] = useSearchParams();
  const [mode, setMode] = useState<"in" | "up">(params.get("welcome") ? "up" : "in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(() => {
    if (sessionStorage.getItem("sceneLingoUnsaved")) {
      sessionStorage.removeItem("sceneLingoUnsaved");
      return "Some subtitles haven't finished saving. They're safe on this computer and will be saved next time you sign in.";
    }
    return "";
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      if (mode === "up") await createUserWithEmailAndPassword(auth, email.trim(), password);
      else await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setMsg(message(err, "Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!email.trim()) return setMsg("Enter your email first, then choose “Forgot password”.");
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMsg("Password reset email sent.");
    } catch (err) {
      setMsg(message(err, "Couldn't send the email. Please try again."));
    }
  }

  return (
    <div className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">SceneLingo</CardTitle>
          <CardDescription>{mode === "up" ? "Create your account." : "Welcome back."}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete={mode === "up" ? "new-password" : "current-password"} required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {msg && <Alert role="alert"><AlertDescription>{msg}</AlertDescription></Alert>}
            <Button disabled={busy}>{mode === "up" ? "Create account" : "Sign in"}</Button>
            <div className="flex justify-between">
              <Button type="button" variant="link" className="h-auto p-0" onClick={() => { setMode(mode === "up" ? "in" : "up"); setMsg(""); }}>
                {mode === "up" ? "I already have an account" : "Create an account"}
              </Button>
              {mode === "in" && <Button type="button" variant="link" className="h-auto p-0" onClick={reset}>Forgot password</Button>}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
