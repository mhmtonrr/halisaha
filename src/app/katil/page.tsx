import Link from "next/link";
import { requireUser } from "@/lib/supabase/server";
import { joinGroup } from "@/lib/actions";
import { extractInviteCode, formatInviteCode, kindMatches, parseKind } from "@/lib/invite";
import { formatRegion } from "@/lib/regions";
import { Badge, Button, Card, ErrorNote, Header, Input, Label } from "@/components/ui";
import { TeamBadge } from "@/components/TeamBadge";
import { SubmitButton } from "@/components/SubmitButton";

const COPY = {
  takim: {
    title: "Takıma katıl",
    intro: "Takım rekabet içindir: herkese açık, rakip takımlara karşı maç yapılır. Kaptandan takımın davet kodunu iste.",
    other: { href: "/katil?tur=grup", label: "Bir gruba mı katılacaksın?" },
  },
  grup: {
    title: "Gruba katıl",
    intro: "Grup arkadaş topluluğu içindir: sadece üyelere görünür, kendi aranızda maç kurup puanlaşırsınız. Kurucudan grubun davet kodunu iste.",
    other: { href: "/katil?tur=takim", label: "Bir takıma mı katılacaksın?" },
  },
  hepsi: {
    title: "Davet koduyla katıl",
    intro: "Takım veya grubun davet kodunu (ya da davet linkini) yaz.",
    other: null,
  },
} as const;

type Info = {
  group_id: string;
  name: string;
  kind: "team" | "community";
  city: string | null;
  district: string | null;
  color: string | null;
  description: string | null;
  members: number;
  already_member: boolean;
};

/** Davet koduyla katıl: kod yazılır, önizleme (ad, tür, bölge, oyuncu sayısı) görülür, onaylanınca katılınır */
export default async function JoinByCodePage({
  searchParams,
}: {
  searchParams: Promise<{ tur?: string; kod?: string; error?: string }>;
}) {
  const { tur, kod, error } = await searchParams;
  const { supabase } = await requireUser();
  const kind = parseKind(tur);
  const copy = COPY[kind ?? "hepsi"];
  const code = kod ? extractInviteCode(kod) : "";

  let info: Info | null = null;
  let notFound = false;
  if (code) {
    const { data } = await supabase.rpc("invite_preview", { p_code: code });
    info = ((Array.isArray(data) ? data[0] : data) as Info | undefined) ?? null;
    notFound = !info;
  }
  const mismatch = info && !kindMatches(kind, info.kind);

  return (
    <main>
      <Header title={copy.title} back="/" />
      <Card className="mb-4 space-y-2 text-sm text-muted">
        <p>{copy.intro}</p>
        {copy.other && (
          <Link href={copy.other.href} className="text-accent underline">
            {copy.other.label}
          </Link>
        )}
      </Card>
      <ErrorNote message={error} />

      <form method="get" className="mt-4 space-y-3">
        {kind && <input type="hidden" name="tur" value={kind} />}
        <Card className="space-y-3">
          <label className="block">
            <Label>Davet kodu</Label>
            <Input
              name="kod"
              defaultValue={code}
              placeholder="XXXXX-XXXXX"
              required
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="text-center text-lg font-bold uppercase tracking-widest"
            />
          </label>
          <Button variant="secondary" className="w-full">
            Kodu kontrol et
          </Button>
        </Card>
      </form>

      {notFound && (
        <p className="mt-4 rounded-xl bg-red-950/60 px-3 py-2 text-sm text-red-300">
          Bu kodla bir takım veya grup bulunamadı. Kodu kontrol et; kod yenilenmiş olabilir, güncel kodu kaptandan/kurucudan iste.
        </p>
      )}

      {info && (
        <Card className="mt-4 space-y-3">
          <div className="flex items-center gap-3">
            <TeamBadge name={info.name} color={info.color} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-lg font-bold">{info.name}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <Badge tone={info.kind === "team" ? "warn" : "accent"}>{info.kind === "team" ? "Takım" : "Grup"}</Badge>
                {formatRegion(info.city, info.district) && <span>{formatRegion(info.city, info.district)}</span>}
                <span>· {info.members} oyuncu</span>
              </div>
            </div>
          </div>
          {info.description && <p className="text-sm text-muted">{info.description}</p>}
          <p className="text-xs text-muted">Kod: {formatInviteCode(code)}</p>

          {info.already_member ? (
            <Link href={`/g/${info.group_id}`} className="block rounded-xl bg-pitch-800 px-4 py-3 text-center text-sm font-semibold hover:bg-pitch-700">
              Zaten üyesin, {info.kind === "team" ? "takımına" : "grubuna"} git ›
            </Link>
          ) : mismatch ? (
            <Link
              href={`/katil?tur=${info.kind === "team" ? "takim" : "grup"}&kod=${encodeURIComponent(code)}`}
              className="block rounded-xl bg-pitch-800 px-4 py-3 text-center text-sm font-semibold hover:bg-pitch-700"
            >
              Bu kod {info.kind === "team" ? "bir takıma" : "bir gruba"} ait, {info.kind === "team" ? "takıma" : "gruba"} katıl ›
            </Link>
          ) : (
            <form action={joinGroup}>
              <input type="hidden" name="code" value={code} />
              {kind && <input type="hidden" name="tur" value={kind} />}
              <SubmitButton className="w-full" pendingLabel="Katılınıyor…">
                {info.kind === "team" ? "Takıma katıl" : "Gruba katıl"}
              </SubmitButton>
            </form>
          )}
        </Card>
      )}
    </main>
  );
}
