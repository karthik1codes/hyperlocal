/** True when avatar is a real news/scene photo (not the LOCAL SVG placeholder). */
export function isUsablePhotoAvatar(url: string | null | undefined): boolean {
  const a = (url || "").trim();
  if (!a) return false;
  if (a.startsWith("data:image/svg")) return false;
  if (/LOCAL<\/text>/i.test(decodeURIComponent(a.slice(0, 800)))) return false;
  if (a.startsWith("/api/img")) return true;
  if (/^https?:\/\//i.test(a)) return true;
  // Embedded jpeg/png/webp from crawl
  if (a.startsWith("data:image/") && a.length > 4_000) return true;
  return false;
}

export function cardHasDisplayArt(card: {
  avatarUrl?: string | null;
  cardImageUrl?: string | null;
}): boolean {
  if (isUsablePhotoAvatar(card.avatarUrl)) return true;
  const art = (card.cardImageUrl || "").trim();
  return art.length > 64;
}
