"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { authErrorMessage } from "@/lib/authErrors";
import { Button, ErrorNote, Input, Label, cx } from "@/components/ui";
import { fieldCard, primaryButton } from "@/components/settings/blocks";

type Mode = "login" | "signup" | "forgot";

const MIN_PASSWORD = 8;

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(initialError ? "Giriş tamamlanamadı, tekrar dene." : "");

  const callback = (to: string) => `${window.location.origin}/auth/callback?next=${encodeURIComponent(to)}`;

  function switchMode(m: Mode) {
    setMode(m);
    setError("");
    setNotice("");
  }

  async function google() {
    setError("");
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callback(next) },
    });
    if (error) setError(authErrorMessage(error));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    const supabase = createClient();

    if (mode === "signup" && password.length < MIN_PASSWORD) {
      setError(`Şifre en az ${MIN_PASSWORD} karakter olmalı.`);
      return;
    }

    setPending(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return setError(authErrorMessage(error));
        router.replace(next);
        router.refresh();
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name.trim() }, emailRedirectTo: callback(next) },
        });
        if (error) return setError(authErrorMessage(error));
        if (data.session) {
          // E-posta onayı kapalıysa doğrudan giriş yapılmış olur
          router.replace(next);
          router.refresh();
        } else if (data.user && data.user.identities?.length === 0) {
          setError(authErrorMessage({ message: "already registered", code: "user_already_exists" }));
        } else {
          setNotice(`${email} adresine bir onay linki gönderdik. Linke tıklayınca hesabın açılacak.`);
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: callback("/sifre-yenile"),
        });
        if (error) return setError(authErrorMessage(error));
        setNotice(`Bu e-postaya kayıtlı bir hesap varsa şifre yenileme linki gönderdik. Linki bu cihazda aç.`);
      }
    } finally {
      setPending(false);
    }
  }

  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      onClick={() => switchMode(m)}
      className={cx(
        "flex-1 rounded-lg py-2 font-display text-sm font-semibold transition",
        mode === m ? "bg-primary font-bold text-on-primary" : "text-on-surface-variant hover:text-on-surface",
      )}
      aria-pressed={mode === m}
    >
      {label}
    </button>
  );

  return (
    <div className={cx(fieldCard, "space-y-4 p-4")}>
      {mode !== "forgot" ? (
        <div className="flex gap-1 rounded-xl bg-surface-low p-1">
          {tab("login", "Giriş yap")}
          {tab("signup", "Kayıt ol")}
        </div>
      ) : (
        <div>
          <h2 className="font-display font-bold">Şifremi unuttum</h2>
          <p className="text-sm text-on-surface-variant">E-posta adresini yaz, şifreni yenilemen için bir link gönderelim.</p>
        </div>
      )}

      <form onSubmit={submit} className="space-y-3">
        {mode === "signup" && (
          <label className="block">
            <Label>Ad soyad</Label>
            <Input
              required
              minLength={2}
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Örn. Ahmet Yılmaz"
            />
          </label>
        )}
        <label className="block">
          <Label>E-posta</Label>
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="ornek@mail.com"
          />
        </label>
        {mode !== "forgot" && (
          <label className="block">
            <Label hint={mode === "signup" ? `en az ${MIN_PASSWORD} karakter` : undefined}>Şifre</Label>
            <Input
              type="password"
              required
              minLength={mode === "signup" ? MIN_PASSWORD : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
            />
          </label>
        )}
        <button className={cx(primaryButton, "disabled:opacity-50")} disabled={pending}>
          {pending
            ? "Bekle…"
            : mode === "login"
              ? "Giriş yap"
              : mode === "signup"
                ? "Hesap oluştur"
                : "Yenileme linki gönder"}
        </button>
        {mode === "login" && (
          <button type="button" onClick={() => switchMode("forgot")} className="w-full text-center text-sm text-on-surface-variant hover:text-on-surface">
            Şifremi unuttum
          </button>
        )}
        {mode === "forgot" && (
          <button type="button" onClick={() => switchMode("login")} className="w-full text-center text-sm text-on-surface-variant hover:text-on-surface">
            ← Girişe dön
          </button>
        )}
      </form>

      {notice && <p className="rounded-xl bg-primary/10 p-3 text-sm text-primary">{notice}</p>}
      <ErrorNote message={error} />

      {mode !== "forgot" && (
        <>
          <div className="flex items-center gap-3 text-xs text-on-surface-variant">
            <span className="h-px flex-1 bg-line" /> veya <span className="h-px flex-1 bg-line" />
          </div>
          <Button variant="secondary" className="w-full" onClick={google} type="button">
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
            Google ile devam et
          </Button>
        </>
      )}
    </div>
  );
}
