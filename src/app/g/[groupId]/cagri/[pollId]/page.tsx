import { LiveRefresh } from "@/components/LiveRefresh";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { acceptResponder, closePoll, rejectResponder, respondPoll, updateGatherPoll } from "@/lib/call-actions";
import { formatDate, POSITIONS, POSITION_NAME, toLocalInput } from "@/lib/data";
import { callWhen, decisionDue, defaultSelection, isoToTime, pendingApplicants, reserveOrder, type Answer, type Responder } from "@/lib/call-rules";
import { loadCall } from "@/lib/calls-data";
import { SendInviteLink } from "@/components/SendInviteLink";
import { Badge, Card, ErrorNote, Header, Input, LinkButton, SectionTitle, cx } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { PushPrompt } from "@/components/PushControls";
import { CallFields } from "../CallFields";
import { FinalizeForm } from "./FinalizeForm";
import { ResponderRow } from "./ResponderRow";

const ANSWERS: { value: Answer; label: string; icon: string; active: string }[] = [
  { value: "yes", label: "Geliyorum", icon: "✅", active: "bg-accent text-pitch-950 border-accent" },
  { value: "maybe", label: "Belki", icon: "🤔", active: "bg-amber-400 text-pitch-950 border-amber-400" },
  { value: "no", label: "Gelemem", icon: "❌", active: "bg-red-400 text-pitch-950 border-red-400" },
];

function Hidden({ groupId, pollId }: { groupId: string; pollId: string }) {
  return (
    <>
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="pollId" value={pollId} />
    </>
  );
}

function myStatusText(r: Responder | undefined, reserveNo: number) {
  if (!r) return null;
  if (r.status === "selected") return "✓ Kadrodasın";
  if (r.status === "reserve") return `Yedektesin (sıran: ${reserveNo}). Yer açılırsa organizatör seni kadroya alabilir.`;
  if (r.status === "rejected") return "Organizatör bu maç için başka oyuncu seçti.";
  if (r.status === "withdrawn") return "Kadrodan çıktın.";
  if (r.answer === "yes") return "Organizatörün kararını bekliyorsun.";
  return null;
}

export default async function CallPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string; pollId: string }>;
  searchParams: Promise<{ error?: string; kesinlestir?: string; duzenle?: string }>;
}) {
  const { groupId, pollId } = await params;
  const { error, kesinlestir, duzenle } = await searchParams;
  const { supabase, user } = await requireUser();
  const [loaded, { data: group }, { data: isMember }] = await Promise.all([
    loadCall(supabase, pollId, groupId),
    supabase.from("groups").select("name, kind").eq("id", groupId).maybeSingle(),
    supabase.rpc("is_group_member", { p_group_id: groupId }),
  ]);
  if (!loaded || !group) notFound();
  const { call, responders, canManage, match } = loaded;
  const isFill = call.purpose === "fill";
  const isCommunity = group.kind === "community";

  const yes = responders.filter((r) => r.answer === "yes");
  const maybe = responders.filter((r) => r.answer === "maybe");
  const no = responders.filter((r) => r.answer === "no");
  const selected = responders.filter((r) => r.status === "selected");
  const reserves = reserveOrder(responders);
  const pending = pendingApplicants(responders);
  const mine = responders.find((r) => r.user_id === user.id);
  const matchPlanned = match?.status === "planned";
  const canRespond = !!isMember && (call.status === "open" || ((call.status === "converted" || call.status === "filled") && matchPlanned));
  const due = canManage && decisionDue(call);

  if (canManage && kesinlestir && call.purpose === "gather" && call.status === "open") {
    const candidates = [...yes, ...maybe].filter((r) => r.status !== "rejected");
    return (
      <main>
        <Header title="Kadroyu kesinleştir" back={`/g/${groupId}/cagri/${pollId}`} />
        <ErrorNote message={error} />
        <p className="mb-4 text-sm text-muted">{callWhen(call)} · {yes.length} geliyor, {maybe.length} belki</p>
        <FinalizeForm
          groupId={groupId}
          call={call}
          candidates={candidates}
          preselected={new Set(defaultSelection(responders, call.capacity))}
          isCommunity={isCommunity}
        />
      </main>
    );
  }

  const statusBadge =
    call.status === "converted" ? <Badge tone="accent">Maç kuruldu</Badge>
    : call.status === "filled" ? <Badge tone="accent">Doldu</Badge>
    : call.status === "open" ? <Badge tone="warn">Açık</Badge>
    : <Badge>Kapandı</Badge>;

  return (
    <main>
      <LiveRefresh
        watches={[
          { table: "match_polls", filter: `id=eq.${pollId}` },
          { table: "poll_responses", filter: `poll_id=eq.${pollId}` },
        ]}
      />
      <Header title={isFill ? "Adam aranıyor" : "Maç çağrısı"} back={`/g/${groupId}`} right={statusBadge} />
      <ErrorNote message={error} />
      {canManage && (call.status === "open" || (call.status === "converted" && matchPlanned)) && (
        <SendInviteLink tur="poll" refId={pollId} className="mb-4" />
      )}

      <Card className="mb-4">
        <div className="text-2xl font-black">{callWhen(call)}</div>
        <div className="mt-0.5 text-sm text-muted">
          {[call.venue && `📍 ${call.venue}`, call.team_size && `${call.team_size}v${call.team_size}`].filter(Boolean).join(" · ")}
        </div>
        {isFill && (
          <div className="mt-2 text-sm">
            <b className="text-accent">{call.capacity} oyuncu</b> aranıyor
            {call.positions.length > 0 && <> · {call.positions.map((p) => POSITION_NAME[p as keyof typeof POSITION_NAME] ?? p).join(", ")}</>}
            {match && (
              <>
                {" "}
                ·{" "}
                <Link href={`/g/${match.group_id}/m/${match.id}`} className="underline">
                  {match.group_name}
                  {match.opponent_name ? ` vs ${match.opponent_name}` : ""}
                </Link>
              </>
            )}
          </div>
        )}
        {call.note && <p className="mt-3 whitespace-pre-line rounded-lg bg-pitch-950 p-3 text-sm">{call.note}</p>}
        <div className="mt-3 flex flex-wrap justify-between gap-1 text-sm">
          <span>
            <b className="text-accent">{yes.length}</b>
            <span className="text-muted">
              {call.capacity && !isFill ? `/${call.capacity}` : ""} geliyor
              {maybe.length > 0 && ` · ${maybe.length} belki`}
              {isFill && ` · ${selected.length}/${call.capacity} alındı`}
            </span>
          </span>
          {call.decide_by && call.status === "open" && !isFill && (
            <span className="text-xs text-muted">Kadro kararı: {formatDate(call.decide_by)}</span>
          )}
        </div>
      </Card>

      {due && (
        <p className="mb-4 rounded-xl border border-amber-400/50 bg-amber-400/10 p-3 text-sm text-amber-200">
          ⏰ Kadro kararı zamanı geldi. Kadroyu kesinleştir veya çağrıyı iptal et.
        </p>
      )}

      {match && (call.status === "converted" || isFill) && (
        <LinkButton href={`/g/${match.group_id}/m/${match.id}`} variant={isFill ? "secondary" : "primary"} className="mb-4 w-full">
          Maça git ›
        </LinkButton>
      )}

      {canRespond && (
        <form action={respondPoll} className="mb-2 space-y-2">
          <Hidden groupId={groupId} pollId={pollId} />
          <div className="text-center text-sm text-muted">{mine ? "Yanıtın (değiştirebilirsin)" : isFill ? "Gelebilir misin?" : "Geliyor musun?"}</div>
          <div className="grid grid-cols-2 gap-2">
            <select name="position" defaultValue={mine?.chosen_position ?? ""} className="min-h-11 rounded-xl border border-line bg-pitch-950 px-3 text-sm" aria-label="Mevki">
              <option value="">Mevki (profilimdeki)</option>
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {POSITION_NAME[p]}
                </option>
              ))}
            </select>
            <Input name="note" maxLength={200} defaultValue={mine?.note ?? ""} placeholder="Not (isteğe bağlı)" />
          </div>
          <div className={cx("grid gap-2", isFill ? "grid-cols-2" : "grid-cols-3")}>
            {ANSWERS.filter((a) => !isFill || a.value !== "maybe").map((a) => (
              <button
                key={a.value}
                name="answer"
                value={a.value}
                className={cx(
                  "flex min-h-14 w-full flex-col items-center justify-center rounded-xl border text-sm font-semibold transition",
                  mine?.answer === a.value ? a.active : "border-line bg-pitch-900 hover:bg-pitch-800",
                )}
              >
                <span>{a.icon}</span>
                {a.label}
              </button>
            ))}
          </div>
          {myStatusText(mine, reserves.findIndex((r) => r.user_id === user.id) + 1) && (
            <p className="text-center text-xs text-muted">{myStatusText(mine, reserves.findIndex((r) => r.user_id === user.id) + 1)}</p>
          )}
        </form>
      )}
      {canRespond && mine && <PushPrompt reason="Kadro kesinleşince veya çağrı değişince haber verelim mi?" />}

      {canManage && call.purpose === "gather" && call.status === "open" && (
        <Card className="mt-4 space-y-2 border-accent/30">
          <div className="text-sm font-semibold">Organizatör</div>
          <p className="text-xs text-muted">Bilgiler netleştikçe düzenle; hazır olunca kadroyu kesinleştir. Gün geçerse çağrı kapanır.</p>
          <div className="grid grid-cols-2 gap-2">
            <LinkButton href={`/g/${groupId}/cagri/${pollId}?kesinlestir=1`} className={cx(yes.length + maybe.length < 2 && "pointer-events-none opacity-50")}>
              Kadroyu kesinleştir ›
            </LinkButton>
            <LinkButton href={`/g/${groupId}/cagri/${pollId}?duzenle=1`} variant="secondary">
              Düzenle
            </LinkButton>
          </div>
          {duzenle && (
            <form action={updateGatherPoll} className="space-y-3 pt-2">
              <Hidden groupId={groupId} pollId={pollId} />
              <input type="hidden" name="day" value={call.play_on} />
              <CallFields
                perTeam={!isCommunity}
                time={isoToTime(call.starts_at)}
                size={call.team_size}
                venue={call.venue ?? ""}
                decideBy={call.decide_by ? toLocalInput(call.decide_by) : ""}
                note={call.note ?? ""}
              />
              <SubmitButton className="w-full" pendingLabel="Kaydediliyor…">
                Kaydet ve yanıt verenlere haber ver
              </SubmitButton>
            </form>
          )}
          <form action={closePoll} className="text-right">
            <Hidden groupId={groupId} pollId={pollId} />
            <button className="text-xs text-muted hover:text-red-300">Çağrıyı iptal et</button>
          </form>
        </Card>
      )}

      {canManage && ((isFill && call.status === "open") || (call.status === "converted" && matchPlanned)) && (
        <>
          <SectionTitle>{isFill ? `Başvurular · ${pending.length}` : `Yedekler · ${reserves.length}`}</SectionTitle>
          {(isFill ? pending : reserves).length === 0 ? (
            <Card className="text-center text-sm text-muted">{isFill ? "Henüz başvuru yok." : "Yedek yok."}</Card>
          ) : (
            <Card className="p-0">
              <ul className="divide-y divide-line">
                {(isFill ? pending : reserves).map((r) => (
                  <ResponderRow key={r.user_id} r={r}>
                    <form action={acceptResponder}>
                      <Hidden groupId={groupId} pollId={pollId} />
                      <input type="hidden" name="userId" value={r.user_id} />
                      <SubmitButton className="min-h-9 px-3 text-xs" pendingLabel="…">
                        Kadroya al
                      </SubmitButton>
                    </form>
                    <form action={rejectResponder}>
                      <Hidden groupId={groupId} pollId={pollId} />
                      <input type="hidden" name="userId" value={r.user_id} />
                      <button className="rounded-lg px-2 py-1 text-xs text-muted hover:text-red-300" aria-label={`${r.display_name} alınmasın`}>
                        ✕
                      </button>
                    </form>
                  </ResponderRow>
                ))}
              </ul>
            </Card>
          )}
          {isFill && (
            <form action={closePoll} className="mt-2 text-right">
              <Hidden groupId={groupId} pollId={pollId} />
              <button className="text-xs text-muted hover:text-red-300">Aramayı durdur</button>
            </form>
          )}
        </>
      )}

      <SectionTitle>Geliyor · {yes.length}</SectionTitle>
      {yes.length === 0 ? (
        <Card className="text-center text-sm text-muted">Henüz kimse &quot;geliyorum&quot; demedi.</Card>
      ) : (
        <Card className="p-0">
          <ol className="divide-y divide-line">
            {yes.map((r) => (
              <ResponderRow key={r.user_id} r={r}>
                {r.status === "selected" && <Badge tone="accent">Kadroda</Badge>}
                {r.status === "reserve" && <Badge>Yedek</Badge>}
                {r.status === "rejected" && <span className="text-xs text-muted">alınmadı</span>}
                {r.status === "withdrawn" && <span className="text-xs text-muted">çekildi</span>}
              </ResponderRow>
            ))}
          </ol>
        </Card>
      )}
      {maybe.length > 0 && (
        <>
          <SectionTitle>Belki · {maybe.length}</SectionTitle>
          <Card className="p-0">
            <ul className="divide-y divide-line">
              {maybe.map((r) => (
                <ResponderRow key={r.user_id} r={r} />
              ))}
            </ul>
          </Card>
        </>
      )}
      {no.length > 0 && (
        <>
          <SectionTitle>Gelemiyor · {no.length}</SectionTitle>
          <Card className="p-0 opacity-70">
            <ul className="divide-y divide-line">
              {no.map((r) => (
                <ResponderRow key={r.user_id} r={r} />
              ))}
            </ul>
          </Card>
        </>
      )}
      <p className="mt-6 text-center text-xs text-muted">
        <Link href={`/g/${groupId}`} className="underline">
          {group.name} sayfasına dön
        </Link>
      </p>
    </main>
  );
}
