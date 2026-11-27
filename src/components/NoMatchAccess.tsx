import { Icon } from "@/components/Icon";
import { Card, Header } from "@/components/ui";

/** Daveti iptal edilen / maçtan çıkarılan (veya görme yetkisi olmayan) kişiye maç adresinde ve davet bağlantısında gösterilir */
export function NoMatchAccess({ title }: { title: string }) {
  return (
    <main>
      <Header title={title} back="/" />
      <Card className="space-y-2 text-center">
        <Icon name="lock" className="text-[32px] text-muted" />
        <p className="font-semibold">Bu maça erişimin yok</p>
        <p className="text-sm text-muted">Davetin iptal edilmiş, kadrodan çıkmış ya da maç silinmiş olabilir. Katılmak istiyorsan maçı ayarlayan kişiden yeni davet iste.</p>
      </Card>
    </main>
  );
}
