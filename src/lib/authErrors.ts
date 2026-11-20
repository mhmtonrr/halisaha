/** Supabase Auth hata mesajlarını Türkçeye çevirir. */
export function authErrorMessage(error: { message: string; status?: number; code?: string }): string {
  const code = error.code ?? "";
  const msg = error.message.toLowerCase();
  if (error.status === 429 || code.includes("rate_limit") || msg.includes("rate limit"))
    return "Çok fazla deneme yapıldı. Birkaç dakika sonra tekrar dene.";
  if (code === "invalid_credentials" || msg.includes("invalid login credentials"))
    return "E-posta veya şifre hatalı.";
  if (code === "user_already_exists" || code === "email_exists" || msg.includes("already registered"))
    return "Bu e-posta ile zaten bir hesap var. Giriş yapmayı dene ya da Google ile devam et.";
  if (code === "weak_password" || msg.includes("password should be"))
    return "Şifre çok zayıf. En az 8 karakter kullan; harf ve rakamı karıştır.";
  if (code === "email_not_confirmed" || msg.includes("email not confirmed"))
    return "E-posta adresin henüz onaylanmamış. Gelen kutundaki onay linkine tıkla.";
  if (code === "validation_failed" || msg.includes("invalid email") || msg.includes("unable to validate email"))
    return "Geçerli bir e-posta adresi gir.";
  if (code === "same_password") return "Yeni şifre eskisiyle aynı olamaz.";
  if (code === "signup_disabled") return "Şu an yeni kayıt alınmıyor.";
  return "Bir sorun oluştu, tekrar dene.";
}
