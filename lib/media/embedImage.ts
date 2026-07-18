import "server-only";

const MAX_EMBED_BYTES = 1_800_000; // keep Redis payloads reasonable

/**
 * Fetch a remote news photo and return a data URL so PlayerCard can paint it
 * without CORS (hotlinked CDNs often fail with crossOrigin=anonymous → silhouette).
 */
export async function embedRemoteImageAsDataUrl(
  url: string,
): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  if (url.startsWith("data:")) return url;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Referer: new URL(url).origin + "/",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(18_000),
    });
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0]!.trim();
    if (!mime.startsWith("image/")) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 200 || bytes.length > MAX_EMBED_BYTES) {
      // Too large to embed — caller can keep the http URL + /api/img proxy
      return null;
    }

    // Shrink with sharp when available so we don't bloat Redis
    try {
      const sharp = (await import("sharp")).default;
      const out = await sharp(bytes)
        .rotate()
        .resize(720, 900, { fit: "cover", position: "attention" })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
      return `data:image/jpeg;base64,${out.toString("base64")}`;
    } catch {
      return `data:${mime};base64,${bytes.toString("base64")}`;
    }
  } catch {
    return null;
  }
}
