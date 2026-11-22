/** Konuşma açılırken anında görünen iskelet (sohbet listesinden tıklayınca boş ekran beklemesin) */
export default function Loading() {
  return (
    <main aria-busy="true">
      <div className="sticky top-0 z-10 -mx-4 mb-2 flex items-center gap-3 border-b border-line bg-pitch-950/95 px-4 py-3">
        <div className="h-9 w-9 rounded-full bg-pitch-800" />
        <div className="h-9 w-9 animate-pulse rounded-full bg-pitch-800" />
        <div className="h-4 w-32 animate-pulse rounded bg-pitch-800" />
      </div>
      <div className="space-y-3 pt-6">
        <div className="h-10 w-2/3 animate-pulse rounded-2xl bg-pitch-800" />
        <div className="ml-auto h-10 w-1/2 animate-pulse rounded-2xl bg-pitch-800/70" />
        <div className="h-10 w-3/5 animate-pulse rounded-2xl bg-pitch-800" />
      </div>
    </main>
  );
}
