import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Gizlilik Politikası · Halısaha" };

const contact = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

export default function PrivacyPage() {
  return (
    <main className="prose-invert py-8 text-sm leading-relaxed text-[#cfe3d7]">
      <Link href="/login" className="text-accent">
        ← Halısaha
      </Link>
      <h1 className="mt-4 text-2xl font-black text-white">Gizlilik Politikası</h1>
      <p className="text-muted">Son güncelleme: 20 Kasım 2026</p>

      <Section title="Uygulama hakkında">
        Halısaha, arkadaş gruplarının halısaha maçlarından sonra birbirlerini puanladığı, oyuncu
        istatistiklerini tuttuğu ve dengeli takımlar kurduğu ücretsiz bir uygulamadır.
      </Section>

      <Section title="Topladığımız bilgiler">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Hesap bilgileri:</b> Google ile veya e-posta ile giriş yaptığınızda adınız, e-posta
            adresiniz ve (Google kullanıyorsanız) profil fotoğrafınızın adresi.
          </li>
          <li>
            <b>Uygulama içi veriler:</b> Üyesi olduğunuz gruplar, oynadığınız maçlar, skorlar, gol,
            asist ve kurtarış sayıları, mevkiniz, verdiğiniz ve aldığınız puanlar ile MVP oyları.
          </li>
          <li>
            <b>Misafir oyuncular:</b> Grup yöneticisinin eklediği, hesabı olmayan oyuncular için
            yalnızca girilen isim ve maç verileri.
          </li>
        </ul>
        Google hesabınızdan bu bilgiler dışında hiçbir veriye (kişiler, e-postalar, dosyalar vb.)
        erişmiyoruz.
      </Section>

      <Section title="Bilgileri nasıl kullanıyoruz">
        Bilgileriniz yalnızca uygulamanın çalışması için kullanılır: sizi tanımak, gruplarınızı
        göstermek, maç sonuçlarını ve oyuncu puanlarını hesaplamak. Verileriniz satılmaz, reklam
        amacıyla kullanılmaz ve üçüncü kişilerle paylaşılmaz.
      </Section>

      <Section title="Kimler görebilir">
        Profiliniz, maç istatistikleriniz ve puanınız yalnızca üyesi olduğunuz grubun diğer
        üyelerine görünür. <b>Verdiğiniz oylar anonimdir:</b> kime kaç puan verdiğinizi diğer
        kullanıcılar göremez; yalnızca puanlama hesaplamasında ve kötüye kullanımı tespit etmek için
        sistem tarafından kullanılır.
      </Section>

      <Section title="Saklama ve güvenlik">
        Veriler, Avrupa Birliği (Frankfurt) bölgesinde barındırılan Supabase altyapısında saklanır ve
        bağlantılar şifrelenir. Erişim, veritabanı seviyesindeki yetki kurallarıyla sınırlandırılır.
        Uygulama Vercel üzerinde çalışır.
      </Section>

      <Section title="Haklarınız">
        6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) ve GDPR kapsamında verilerinize erişme,
        düzeltilmesini veya silinmesini isteme hakkınız vardır. Hesabınızın ve verilerinizin
        silinmesini talep ettiğinizde tüm kişisel bilgileriniz silinir.
        {contact ? (
          <>
            {" "}
            Talepleriniz için: <a className="text-accent" href={`mailto:${contact}`}>{contact}</a>
          </>
        ) : (
          " Talepleriniz için uygulamanın Google giriş ekranında görünen destek e-posta adresine yazabilirsiniz."
        )}
      </Section>

      <Section title="Değişiklikler">
        Bu politika güncellenirse yeni sürüm bu sayfada yayınlanır.
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-base font-bold text-white">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
