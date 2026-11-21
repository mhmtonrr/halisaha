/**
 * Realtime filtre yardımcıları. İstemci bileşeni dosyasında (LiveRefresh) değil burada durur:
 * sunucu bileşenleri istemci modüllerindeki fonksiyonları çağıramaz.
 */

/** Çok gruplu sayfalar için `column=in.(a,b,c)` filtresi (Realtime en fazla 100 değer alır) */
export const inList = (column: string, ids: string[]) => `${column}=in.(${ids.slice(0, 100).join(",")})`;
