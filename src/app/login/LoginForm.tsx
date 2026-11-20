"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, ErrorNote, Input } from "@/components/ui";

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState(initialError ? "Giriş tamamlanamadı, tekrar deneyin." : "");

  const redirectTo = () =>
    `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function google() {
    setError("");
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo() },
    });
    if (error) setError(error.message);
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setState("sending");
    const { error } = await createClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo() },
    });
    if (error) {
      setState("idle");
      setError(
        error.status === 429
          ? "Çok fazla deneme yapıldı, birkaç dakika sonra tekrar deneyin."
          : error.message,
      );
    } else {
      setState("sent");
    }
  }

  return (
    <Card className="space-y-4">
      <Button variant="secondary" className="w-full" onClick={google}>
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        Google ile devam et
      </Button>

      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" /> veya <span className="h-px flex-1 bg-line" />
      </div>

      {state === "sent" ? (
        <p className="rounded-xl bg-accent/10 p-3 text-sm text-accent">
          <b>{email}</b> adresine giriş linki gönderdik. Linke bu cihazdan tıklayın.
        </p>
      ) : (
        <form onSubmit={sendLink} className="space-y-3">
          <Input
            type="email"
            required
            placeholder="E-posta adresin"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <Button className="w-full" disabled={state === "sending"}>
            {state === "sending" ? "Gönderiliyor…" : "E-postama giriş linki gönder"}
          </Button>
        </form>
      )}
      <ErrorNote message={error} />
    </Card>
  );
}
