// Sabit dizilişler (5-11 kişilik) ve oyuncuları mevkilerine göre dizilişe yerleştirme.
// Saf fonksiyonlar (veritabanı yok) — src/lib/formations.test.ts ile test edilir.
//
// Saha dikey çizilir: kendi kalemiz altta (y büyük), hücum yönü yukarı (y küçük). x/y yüzdedir (0-100).

export type Role = "GK" | "DEF" | "MID" | "FWD";

export interface Slot {
  /** Dizilişteki sıra: 0 = kaleci, sonra savunmadan hücuma, soldan sağa */
  index: number;
  role: Role;
  /** Saha üzerinde yatay konum, % */
  x: number;
  /** Saha üzerinde dikey konum, % */
  y: number;
}

export interface Formation {
  /** "2-3-1" gibi; kaleci yazılmaz */
  id: string;
  size: number;
  /** Savunmadan hücuma her hattaki oyuncu sayısı */
  lines: number[];
  slots: Slot[];
}

export const MIN_SIZE = 5;
export const MAX_SIZE = 11;
export const SIZES = Array.from({ length: MAX_SIZE - MIN_SIZE + 1 }, (_, i) => MIN_SIZE + i);

/** Her kişi sayısı için hazır dizilişler; ilki varsayılandır. */
const FORMATIONS: Record<number, string[]> = {
  5: ["2-2", "1-2-1", "2-1-1", "1-1-2"],
  6: ["2-2-1", "2-1-2", "1-3-1", "3-1-1", "1-2-2"],
  7: ["2-3-1", "3-2-1", "2-2-2", "3-1-2", "1-3-2"],
  8: ["3-3-1", "2-3-2", "3-2-2", "2-4-1", "4-2-1"],
  9: ["3-3-2", "3-4-1", "4-3-1", "2-4-2", "4-2-2"],
  10: ["4-3-2", "3-4-2", "4-4-1", "3-3-3", "5-3-1"],
  11: ["4-4-2", "4-3-3", "4-5-1", "3-5-2", "3-4-3", "5-3-2"],
};

/** Hat sayısına göre roller: 2 hat → DEF/FWD, 3 → DEF/MID/FWD, 4 → DEF/MID/MID/FWD ... */
function rolesFor(lineCount: number): Role[] {
  if (lineCount === 1) return ["MID"];
  return Array.from({ length: lineCount }, (_, i) =>
    i === 0 ? "DEF" : i === lineCount - 1 ? "FWD" : "MID",
  );
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildSlots(lines: number[]): Slot[] {
  const slots: Slot[] = [{ index: 0, role: "GK", x: 50, y: 90 }];
  const roles = rolesFor(lines.length);
  lines.forEach((count, li) => {
    // Savunma hattı kaleye yakın (y=72), hücum hattı rakip kaleye yakın (y=16)
    const y = lines.length === 1 ? 44 : 72 - (li * (72 - 16)) / (lines.length - 1);
    for (let j = 0; j < count; j++) {
      slots.push({
        index: slots.length,
        role: roles[li],
        x: round1(((j + 1) / (count + 1)) * 100),
        y: round1(y),
      });
    }
  });
  return slots;
}

function parse(id: string): number[] {
  return id.split("-").map(Number);
}

export function formationsFor(size: number): Formation[] {
  return (FORMATIONS[size] ?? []).map((id) => {
    const lines = parse(id);
    return { id, size, lines, slots: buildSlots(lines) };
  });
}

export function getFormation(size: number, id: string | null | undefined): Formation | null {
  return formationsFor(size).find((f) => f.id === id) ?? null;
}

export function defaultFormation(size: number): Formation {
  return formationsFor(size)[0] ?? formationsFor(7)[0];
}

/** Kişi sayısı kayıtlı olmayan eski maçlar için kadrodan tahmin (5-11 arasına sıkıştırılır) */
export function inferSize(teamPlayerCount: number): number {
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, teamPlayerCount));
}

export const isValidSize = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= MIN_SIZE && n <= MAX_SIZE;

// ---------------------------------------------------------------------------
// Otomatik yerleştirme
// ---------------------------------------------------------------------------

export interface Candidate {
  id: string;
  position: Role | null;
  overall: number;
}

/**
 * Oyuncunun slota uygunluğu: kaleci sadece kaleye, kalan roller kendi hattına yakışır.
 * Kadroda kaleci yoksa kaleye en yakın mevki savunmacıdır (DEF > MID > FWD).
 */
function fit(position: Role | null, role: Role): number {
  if (role === "GK") {
    return position === "GK" ? 3 : position === null ? 0 : position === "DEF" ? -3 : position === "MID" ? -4 : -5;
  }
  if (position === "GK") return -5;
  if (position === role) return 2;
  return position === null ? 1 : 0;
}

/**
 * Oyuncuları diziliş slotlarına mevkilerine göre yerleştirir. Dönen harita: oyuncu → slot sırası
 * (yedekte kalanlar null). `prefer` verilen oyuncular eşit uygunlukta öne alınır (örneğin dizilişi
 * değiştirirken sahada olanların sahada kalması için).
 */
export function autoLineup(
  players: Candidate[],
  formation: Formation,
  prefer: string[] = [],
): Record<string, number | null> {
  const preferred = new Set(prefer);
  const result: Record<string, number | null> = Object.fromEntries(players.map((p) => [p.id, null]));
  const free = new Map(players.map((p) => [p.id, p]));
  // Kalecinin seçimi diğer hatları bozmasın: önce kaleci, sonra savunmadan hücuma
  for (const slot of formation.slots) {
    let best: { p: Candidate; score: number } | null = null;
    for (const p of free.values()) {
      // Kalecisiz kadroda kaleye zayıf oyuncu geçer; en iyiler sahada kalır (gerçek kaleci için tersi)
      const ovr = slot.role === "GK" && p.position !== "GK" ? -p.overall : p.overall;
      const score = fit(p.position, slot.role) + (preferred.has(p.id) ? 0.5 : 0) + ovr / 1000;
      if (!best || score > best.score) best = { p, score };
    }
    if (!best) break;
    result[best.p.id] = slot.index;
    free.delete(best.p.id);
  }
  return result;
}

/** Atamanın geçerli olduğunu doğrular: slotlar aralıkta ve benzersiz */
export function validAssignment(assign: Record<string, number | null>, formation: Formation): boolean {
  const used = new Set<number>();
  for (const slot of Object.values(assign)) {
    if (slot === null) continue;
    if (!Number.isInteger(slot) || slot < 0 || slot >= formation.slots.length || used.has(slot)) return false;
    used.add(slot);
  }
  return true;
}

/**
 * Sahada oyuncu kartının genişliği, saha genişliğinin yüzdesi olarak: en kalabalık hatta kartlar yan yana
 * sığacak şekilde (hat başına en fazla 5 oyuncu → ~%16, 2-3 oyuncu → %28-38). Üst sınır %38.
 */
export function cardWidthPct(formation: Formation): number {
  const perLine = new Map<number, number>();
  for (const s of formation.slots) perLine.set(s.y, (perLine.get(s.y) ?? 0) + 1);
  const widest = Math.max(...perLine.values());
  return Math.min(38, Math.round((100 / (widest + 1.3)) * 10) / 10);
}
