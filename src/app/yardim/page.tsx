import { requireUser } from "@/lib/supabase/server";
import { SubScreen } from "@/components/settings/SubScreen";
import { Icon } from "@/components/Icon";
import Link from "next/link";

const FAQ: { q: string; a: string }[] = [
  {
    q: "Grup ile takım arasındaki fark nedir?",
    a: "Grup özel bir topluluktur: sadece kendi aranızda maç yaparsınız ve rating'e etkisi yarımdır. Takım herkese açıktır: rakip takıma karşı oynarsınız, maçlar tam etki eder ve Keşfet'te sıralamaya girer.",
  },
  {
    q: "Rating (genel puan) nasıl hesaplanır?",
    a: "Maçtan sonra oyuncular birbirini puanlar. Puanlar, oy verenin kendi puanlama alışkanlığına göre dengelenir (herkese 9 veren de herkese 5 veren de aynı oyuncuyu ortalama görür). Rating hesabına göre tek hesaplanır ve tüm grup ve takımlarındaki kartına yansır.",
  },
  {
    q: "Maç sonrası oylama nasıl çalışır?",
    a: "Maç sonucu girilince oylama açılır ve 24 saat sürer. Rakip takımdaki oyuncuları da puanlayabilirsin. Yeterli oy toplanmayan maçın rating'e etkisi sıfır sayılır.",
  },
  {
    q: "Kartımdaki yetenekler (HIZ, ŞUT, PAS…) nereden geliyor?",
    a: "Birlikte en az 2 maç oynadığın kişiler seni 1-10 arası puanlar; kimin ne verdiği görünmez. En az 2 farklı kişi puan verince değer kartında görünür. Sen de Ayarlar veya ana sayfadaki bağlantıyla arkadaşlarını puanlayabilirsin.",
  },
  {
    q: "Gruba veya takıma nasıl katılırım?",
    a: "Kaptanın veya yöneticinin verdiği davet kodunu ya da bağlantıyı kullan: menüdeki \"Takıma / gruba katıl\" ekranına kodu yaz. Takım ilanlarına Keşfet'ten başvurabilirsin.",
  },
  {
    q: "Maçta gelemeyeceksem ne olur?",
    a: "Kadro kurulmadan önce çağrıda \"gelemem\" diyebilirsin. Maç kurulup kadroya girdikten sonra Taktik Odası'ndan \"Maça gelemeyeceğim\" dersin; kaptan veya yetkili onaylarsa güvenilirliğin bozulmaz. Onaysız gelmezsen \"gelmedi\" işaretlenir ve güvenilirlik oranını düşürür.",
  },
  {
    q: "Profilimi kimler görür?",
    a: "Kartın (rating, yetenekler, bölge) herkese görünür. İstatistik ve maç geçmişini sadece takım arkadaşların görür; Ayarlar'daki \"İstatistiklerimi Paylaş\" anahtarını açarsan giriş yapan herkes görür. Özel grupların adı hiçbir zaman başkalarına gösterilmez.",
  },
  {
    q: "Hesabımı geçici dondurursam ne olur?",
    a: "Oyuncu aramasında ve öne çıkanlarda görünmezsin, bildirim almazsın. Maç geçmişin ve kartın silinmez. Ayarlar'dan istediğin an \"Hesabımı Yeniden Aç\" diyebilirsin.",
  },
  {
    q: "Bildirimler gelmiyor, ne yapmalıyım?",
    a: "Ayarlar > Bildirimler'de \"Bu Cihazda Bildirimler\" açık olmalı. iPhone'da önce uygulamayı ana ekrana eklemelisin. Android'de pil ayarını \"Sınırsız\", bildirim önemini \"Yüksek\" yapman gerekebilir.",
  },
  {
    q: "Verilerim nasıl saklanıyor?",
    a: "Doğum tarihin sadece sana görünür. Verilerin KVKK kapsamında saklanır; ayrıntı için Gizlilik Politikası'na bak. Silme talebin için Geri Bildirim'den bize yazabilirsin.",
  },
];

export default async function HelpPage() {
  await requireUser();
  return (
    <SubScreen title="Yardım Merkezi & SSS">
      <div className="flex flex-col overflow-hidden rounded-xl bg-surface-container shadow-sm">
        {FAQ.map((f) => (
          <details key={f.q} className="group border-b border-line last:border-0">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3.5 font-semibold text-on-surface">
              <span>{f.q}</span>
              <Icon name="expand_more" className="shrink-0 text-[22px] text-outline transition-transform group-open:rotate-180" />
            </summary>
            <p className="t-body-md px-3.5 pb-3.5 text-on-surface-variant">{f.a}</p>
          </details>
        ))}
      </div>
      <p className="t-body-sm px-1 text-on-surface-variant">
        Cevabını bulamadın mı? <Link href="/geri-bildirim" className="text-primary underline">Geri bildirim gönder</Link> ya da <Link href="/privacy" className="text-primary underline">gizlilik politikasını</Link> oku.
      </p>
    </SubScreen>
  );
}
