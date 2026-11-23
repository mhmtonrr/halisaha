// Birleşik çağrı kuralları (toplama / adam ara). Saf fonksiyonlar — call-rules.test.ts ile test edilir.
// Yetki ve geçerlilik veritabanında (0035); burada sadece ekranda gösterilecek sıralama ve metinler.

export type Answer = "yes" | "maybe" | "no";
export type ResponseStatus = "selected" | "reserve" | "rejected" | "withdrawn" | null;

export interface Responder {
  user_id: string;
  display_name: string;
  answer: Answer;
  chosen_position: string | null;
  preferred_position: string | null;
  note: string | null;
  status: ResponseStatus;
  responded_at: string;
  overall: number;
  /** Sadece organizatöre gelir (diğerlerine null) */
  played: number | null;
  no_shows: number | null;
}

export interface CallShape {
  purpose: "gather" | "fill";
  status: "open" | "filled" | "closed" | "converted";
  play_on: string;
  starts_at: string | null;
  capacity: number | null;
  team_size: number | null;
  decide_by: string | null;
}

const byTime = (a: Responder, b: Responder) => a.responded_at.localeCompare(b.responded_at) || a.user_id.localeCompare(b.user_id);

/** Kesinleştirme ekranında varsayılan seçim: "geliyorum" diyenlerden yanıt sırasıyla ilk N (N = kontenjan; yoksa hepsi) */
export function defaultSelection(responders: Responder[], capacity: number | null): string[] {
  const yes = responders.filter((r) => r.answer === "yes" && r.status !== "rejected").sort(byTime);
  return (capacity ? yes.slice(0, capacity) : yes).map((r) => r.user_id);
}

/** Yedek sırası: kesinleşmiş çağrıda yanıt sırasıyla */
export function reserveOrder(responders: Responder[]): Responder[] {
  return responders.filter((r) => r.status === "reserve" && r.answer === "yes").sort(byTime);
}

/** Adam aramada bekleyen başvurular (kabul/ret edilmemiş "geliyorum"lar) */
export function pendingApplicants(responders: Responder[]): Responder[] {
  return responders.filter((r) => r.answer === "yes" && (r.status === null || r.status === "reserve")).sort(byTime);
}

/** Karar zamanı geçti mi? (toplama çağrısı hâlâ açıksa organizatöre "kadroyu kesinleştir" uyarısı) */
export function decisionDue(call: CallShape, now = Date.now()): boolean {
  return call.purpose === "gather" && call.status === "open" && !!call.decide_by && new Date(call.decide_by).getTime() <= now;
}

/** Bugün maç günü mü / geçti mi (Türkiye saati) */
export function istanbulDate(now = Date.now()): string {
  return new Date(now + 3 * 3600_000).toISOString().slice(0, 10);
}

/** "Cuma 28 Kas · saat belli değil" veya "Cum 28 Kas 21:00" */
export function callWhen(call: Pick<CallShape, "play_on" | "starts_at">): string {
  if (call.starts_at) {
    return new Date(call.starts_at).toLocaleString("tr-TR", {
      timeZone: "Europe/Istanbul",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  const day = new Date(`${call.play_on}T12:00:00+03:00`).toLocaleDateString("tr-TR", {
    timeZone: "Europe/Istanbul",
    weekday: "long",
    day: "numeric",
    month: "short",
  });
  return `${day} · saat belli değil`;
}

/** Türkiye saatiyle gün + "HH:MM" → ISO (saat boşsa null) */
export function dayTimeToIso(day: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return null;
  return new Date(`${day}T${time}:00+03:00`).toISOString();
}

/** ISO → Türkiye saatiyle "HH:MM" (form varsayılanı) */
export function isoToTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(new Date(iso).getTime() + 3 * 3600_000).toISOString().slice(11, 16);
}
