/** Same-origin proxy for remote card avatars (avoids CORS → silhouette fallback). */
export function cardAvatarSrc(url: string | null | undefined): string {
  const u = (url || "").trim();
  if (!u) return "";
  if (u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("/")) return u;
  if (/^https?:\/\//i.test(u)) {
    return `/api/img?u=${encodeURIComponent(u)}`;
  }
  return u;
}

export function isProxiedOrLocalAvatar(url: string): boolean {
  return (
    url.startsWith("data:") ||
    url.startsWith("blob:") ||
    url.startsWith("/") ||
    url.startsWith("/api/img")
  );
}
