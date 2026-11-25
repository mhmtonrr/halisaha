import { redirect } from "next/navigation";

/** Eski "çağrı aç" adresi → tek "Maç ayarla" formu (yeniden tasarım 4a) */
export default async function Page({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  redirect(`/mac-ayarla?grup=${groupId}`);
}
