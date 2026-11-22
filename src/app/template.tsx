/** Her sayfa geçişinde yeniden oluşur: içerik kısa bir solma ile gelir */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="hs-page-in">{children}</div>;
}
