"use client";

import { useRef, useState, useTransition } from "react";
import { completeOnboarding } from "@/lib/actions";
import { CardFace } from "@/components/PlayerCard";
import { CardPhotoUploader, type CardPhotoHandle } from "@/components/CardPhotoUploader";
import { RegionSelect } from "@/components/RegionSelect";
import { Icon } from "@/components/Icon";
import { chip, fieldCard, primaryButton, textareaClass } from "@/components/settings/blocks";
import { ErrorNote, Input, Label, cx } from "@/components/ui";
import { validateCardName } from "@/lib/card-name";
import { FOOT_NAME, POSITION_NAME, POSITIONS, type Foot, type Position } from "@/lib/data";
import { cardSkills } from "@/lib/skills";

export interface WelcomeValues {
  name: string;
  cardName: string;
  birthDate: string;
  city: string;
  district: string;
  position: Position | null;
  secondary: Position[];
  foot: Foot | null;
  shirt: number | null;
  height: number | null;
  weight: number | null;
  bio: string;
}

const STEPS = [
  { title: "Seni tanıyalım", text: "Kartında ve uygulamada nasıl görüneceksin?" },
  { title: "Nerede oynuyorsun?", text: "Yakınındaki maçları ve oyuncuları gösterebilmemiz için." },
  { title: "Sahadaki yerin", text: "Mevkin kartında görünür, takımlar buna göre kurulur." },
  { title: "Kart fotoğrafın", text: "İsteğe bağlı; sonradan Ayarlar'dan da ekleyebilirsin." },
];

/** İlk girişteki adım adım karşılama: üstteki kart yazdıkça güncellenir, bilgiler son adımda tek seferde kaydedilir */
export function WelcomeWizard({
  userId,
  next,
  photoUrl,
  rating,
  maxBirth,
  values,
}: {
  userId: string;
  next: string;
  photoUrl: string | null;
  rating: number;
  maxBirth: string;
  values: WelcomeValues;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(values.name);
  const [cardName, setCardName] = useState(values.cardName);
  const [region, setRegion] = useState({ city: values.city, district: values.district });
  const [position, setPosition] = useState(values.position);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const panels = useRef<(HTMLDivElement | null)[]>([]);
  const photo = useRef<CardPhotoHandle>(null);
  const [photoWorking, setPhotoWorking] = useState(false);
  const last = step === STEPS.length - 1;

  const preview = {
    name: name.trim() || "Adın",
    cardName,
    overall: rating,
    position,
    skills: cardSkills(null, position === "GK"),
    city: region.city || null,
    district: region.district || null,
    unrated: true,
  };

  function go(to: number) {
    setError("");
    setStep(to);
    window.scrollTo({ top: 0 });
  }

  /** Sadece açık adımın alanlarını doğrular; gizli adımlar tarayıcı doğrulamasını sessizce takmasın */
  function stepValid() {
    if (step === 0) {
      const card = validateCardName(cardName);
      if (!card.ok) return setError(card.error), false;
    }
    if (step === 2 && !position) return setError("Ana mevkini seç"), false;
    const fields = panels.current[step]?.querySelectorAll<HTMLInputElement>("input, select, textarea") ?? [];
    return Array.from(fields).every((el) => el.reportValidity());
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || (last && photoWorking) || !stepValid()) return;
    if (!last) return go(step + 1);
    const fd = new FormData(e.currentTarget);
    setError("");
    startTransition(async () => {
      // Seçilip "Kaydet"e basılmamış fotoğraf kaybolmasın
      if (photo.current && !(await photo.current.savePending())) return;
      const res = await completeOnboarding(fd);
      if (res?.error) setError(res.error);
    });
  }

  const panel = (i: number) => ({
    ref: (el: HTMLDivElement | null) => {
      panels.current[i] = el;
    },
    className: cx(fieldCard, "flex flex-col gap-3.5", step !== i && "hidden"),
  });

  return (
    <main className="py-6">
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => go(step - 1)}
          disabled={pending}
          aria-label="Önceki adım"
          className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-container", step === 0 && "invisible")}
        >
          <Icon name="arrow_back" className="text-[22px]" />
        </button>
        <div className="flex flex-1 gap-1.5" aria-label={`Adım ${step + 1} / ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <span key={s.title} className={cx("h-1.5 flex-1 rounded-full transition-colors", i <= step ? "bg-primary" : "bg-surface-highest")} />
          ))}
        </div>
        <span className="t-label-caps w-10 shrink-0 text-right text-on-surface-variant">
          {step + 1}/{STEPS.length}
        </span>
      </div>

      <div className="mb-4 text-center">
        <h1 className="font-display text-2xl font-black tracking-tight">{STEPS[step].title}</h1>
        <p className="t-body-sm mt-1 text-on-surface-variant">{STEPS[step].text}</p>
      </div>

      {/* Son adımda kartı fotoğraf yükleyici çizer */}
      {!last && (
        <div className="mb-4 flex justify-center">
          <CardFace {...preview} photoUrl={photoUrl} fontSize="14px" />
        </div>
      )}

      <form id="welcome" onSubmit={submit} noValidate>
        <input type="hidden" name="next" value={next} />

        <div {...panel(0)}>
          <label className="block">
            <Label>Ad soyad</Label>
            <Input
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={40}
              autoComplete="name"
              placeholder="Örn. Ahmet Yılmaz"
            />
          </label>
          <label className="block">
            <Label hint="isteğe bağlı">Kartta görünen ad</Label>
            <Input
              name="cardName"
              value={cardName}
              onChange={(e) => {
                setCardName(e.target.value);
                setError("");
              }}
              maxLength={20}
              placeholder="Örn. Memo veya Mehmet O."
            />
            <p className="mt-1 text-xs text-on-surface-variant">Boş bırakırsan kartında adın görünür. Sadece harf, boşluk ve nokta.</p>
          </label>
          <label className="block">
            <Label hint="isteğe bağlı, sadece sen görürsün">Doğum tarihi</Label>
            <Input type="date" name="birthDate" min="1940-01-01" max={maxBirth} defaultValue={values.birthDate} />
          </label>
        </div>

        <div {...panel(1)}>
          <RegionSelect
            defaultCity={values.city}
            defaultDistrict={values.district}
            onValue={(city, district) => setRegion({ city, district })}
          />
        </div>

        <div {...panel(2)}>
          <div>
            <Label>Ana mevki</Label>
            <div className="grid grid-cols-4 gap-2">
              {POSITIONS.map((p) => (
                <label key={p} className={chip}>
                  <input
                    type="radio"
                    name="position"
                    value={p}
                    checked={position === p}
                    onChange={() => {
                      setPosition(p);
                      setError("");
                    }}
                    className="sr-only"
                  />
                  {POSITION_NAME[p]}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label hint="isteğe bağlı, birden fazla">Diğer mevkiler</Label>
            <div className="grid grid-cols-4 gap-2">
              {POSITIONS.map((p) => (
                <label key={p} className={cx(chip, position === p && "pointer-events-none opacity-40")}>
                  <input
                    type="checkbox"
                    name="secondary"
                    value={p}
                    defaultChecked={values.secondary.includes(p)}
                    disabled={position === p}
                    className="sr-only"
                  />
                  {POSITION_NAME[p]}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label hint="isteğe bağlı">Ayak</Label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(FOOT_NAME) as Foot[]).map((f) => (
                <label key={f} className={chip}>
                  <input type="radio" name="foot" value={f} defaultChecked={values.foot === f} className="sr-only" />
                  {FOOT_NAME[f]}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <label>
              <Label>Forma no</Label>
              <Input type="number" inputMode="numeric" name="shirt" min={1} max={99} defaultValue={values.shirt ?? ""} className="text-center" />
            </label>
            <label>
              <Label hint="cm">Boy</Label>
              <Input type="number" inputMode="numeric" name="height" min={120} max={230} defaultValue={values.height ?? ""} placeholder="182" className="text-center" />
            </label>
            <label>
              <Label hint="kg">Kilo</Label>
              <Input type="number" inputMode="numeric" name="weight" min={30} max={200} defaultValue={values.weight ?? ""} placeholder="76" className="text-center" />
            </label>
          </div>
          <label className="block">
            <Label hint="isteğe bağlı">Hakkımda</Label>
            <textarea
              name="bio"
              maxLength={160}
              rows={2}
              defaultValue={values.bio}
              placeholder="Örn. Sol kanattan bindiren, şutu sert bir oyuncu"
              className={textareaClass}
            />
          </label>
        </div>
      </form>

      {/* Formun dışında; geri dönüldüğünde seçilen fotoğraf kaybolmasın diye hep bağlı, sadece gizlenir */}
      <div className={cx(fieldCard, !last && "hidden")}>
        <CardPhotoUploader userId={userId} currentUrl={photoUrl} preview={preview} handleRef={photo} onWorkingChange={setPhotoWorking} />
      </div>

      <ErrorNote message={error} />
      <button type="submit" form="welcome" disabled={pending || (last && photoWorking)} className={cx(primaryButton, "mt-4 disabled:opacity-50")}>
        {pending ? "Kaydediliyor…" : last ? "Bitir" : "Devam et"}
      </button>
    </main>
  );
}
