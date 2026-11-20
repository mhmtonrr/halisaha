import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  return (
    <main className="flex min-h-dvh flex-col justify-center py-10">
      <div className="mb-10 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-pitch-800 text-4xl">⚽</div>
        <h1 className="text-3xl font-black tracking-tight">Halısaha</h1>
        <p className="mt-2 text-muted">Maçtan sonra puanla, kartını büyüt, takımları adil kur.</p>
      </div>
      <LoginForm next={next?.startsWith("/") ? next : "/"} initialError={error} />
    </main>
  );
}
