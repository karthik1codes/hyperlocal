import { NextResponse } from "next/server";
import { hasBentoCredentials } from "@/lib/bento/config";
import { probePublicSdk } from "@/lib/bento/public-api";

export const dynamic = "force-dynamic";

/**
 * GET /api/bento/public/probe
 * Live smoke-test of sdk.public against BENTO_URL + BENTO_BUILDER_API_KEY.
 */
export async function GET() {
  if (!hasBentoCredentials()) {
    return NextResponse.json(
      { error: "Set BENTO_BUILDER_API_KEY (and BENTO_URL) first." },
      { status: 503 },
    );
  }
  try {
    const report = await probePublicSdk();
    return NextResponse.json({
      ok: report.failCount === 0,
      ...report,
      howToRead:
        "ok=true means the SDK call succeeded against your BENTO_URL. Failures often mean the route is auth-gated, missing on internal, or needs real ids.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Probe failed" },
      { status: 500 },
    );
  }
}
