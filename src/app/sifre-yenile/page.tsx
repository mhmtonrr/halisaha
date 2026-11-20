"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { authErrorMessage } from "@/lib/authErrors";
import { Button, Card, ErrorNote, Header, Input, Label } from "@/components/ui";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) return setError("Şifre en az 8 karakter olmalı.");
    if (password !== repeat) return setError("Şifreler aynı değil.");
    setPending(true);
    const { error } = await createClient().auth.updateUser({ password });
    setPending(false);
    if (error) return setError(authErrorMessage(error));
    setDone(true);
    setTimeout(() => {
      router.replace("/");
      router.refresh();
    }, 1500);
  }

  return (
    <main>
      <Header title="Yeni şifre belirle" back="/" />
      <Card>
        {done ? (
          <p className="text-center text-accent">Şifren güncellendi ✓ Yönlendiriliyorsun…</p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <Label hint="en az 8 karakter">Yeni şifre</Label>
              <Input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </label>
            <label className="block">
              <Label>Yeni şifre (tekrar)</Label>
              <Input type="password" required value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" />
            </label>
            <Button className="w-full" disabled={pending}>
              {pending ? "Kaydediliyor…" : "Şifreyi kaydet"}
            </Button>
            <ErrorNote message={error} />
          </form>
        )}
      </Card>
    </main>
  );
}
