import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BYTES = 6_000_000;

/**
 * Same-origin image proxy so PlayerCard can show hotlinked news photos
 * (remote hosts often block CORS → crossOrigin="anonymous" → silhouette).
 */
export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("u")?.trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "u=https://… required" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return NextResponse.json({ error: "unsupported protocol" }, { status: 400 });
  }

  try {
    const res = await fetch(target.toString(), {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Referer: target.origin + "/",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(18_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });
    }
    const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0]!.trim();
    if (!mime.startsWith("image/")) {
      return NextResponse.json({ error: "not an image" }, { status: 415 });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 64 || buf.length > MAX_BYTES) {
      return NextResponse.json({ error: "image size rejected" }, { status: 413 });
    }
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        // Allow canvas capture from our own origin
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "fetch failed" },
      { status: 502 },
    );
  }
}
