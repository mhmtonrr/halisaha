import { redirect } from "next/navigation";

/** Eski çağrı adresi (çağrılar 0047'de kalktı; maç ayarlama tek maç kaydıyla) → grup sayfası */
export default async function Page({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  redirect(`/g/${groupId}`);
}
