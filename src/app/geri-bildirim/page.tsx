import { requireUser } from "@/lib/supabase/server";
import { sendFeedback } from "@/lib/actions";
import { SubScreen } from "@/components/settings/SubScreen";
import { primaryButton } from "@/components/settings/blocks";
import { Label } from "@/components/ui";

const chip =
  "flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-surface-high px-1 text-center text-[13px] text-on-surface-variant has-checked:bg-primary has-checked:font-semibold has-checked:text-on-primary";

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { error, saved } = await searchParams;
  await requireUser();
  return (
    <SubScreen title="Geri Bildirim Gönder" error={error}>
      {saved ? (
        <p className="rounded-xl bg-primary/10 p-4 text-center text-sm text-primary">Teşekkürler, geri bildirimin bize ulaştı ✓</p>
      ) : (
        <form action={sendFeedback} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-3.5 rounded-xl bg-surface-container p-3.5 shadow-sm">
            <div>
              <Label>Konu</Label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ["oneri", "Öneri"],
                  ["hata", "Hata"],
                  ["genel", "Diğer"],
                ].map(([v, l]) => (
                  <label key={v} className={chip}>
                    <input type="radio" name="category" value={v} defaultChecked={v === "oneri"} className="sr-only" />
                    {l}
                  </label>
                ))}
              </div>
            </div>
            <label className="block">
              <Label hint="5-1000 karakter">Mesajın</Label>
              <textarea
                name="message"
                required
                minLength={5}
                maxLength={1000}
                rows={6}
                placeholder="Neyi geliştirebiliriz? Bir hata mı gördün?"
                className="w-full rounded-xl border border-line bg-pitch-950 p-3 text-sm outline-none placeholder:text-muted/60 focus:border-accent"
              />
            </label>
          </div>
          <button className={primaryButton}>Gönder</button>
        </form>
      )}
    </SubScreen>
  );
}
