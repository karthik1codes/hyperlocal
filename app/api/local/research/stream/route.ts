import type { ResearchProgressEvent } from "@/lib/local/progress";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const runtime = "nodejs";

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Live research stream — emits progress steps, then a final `result` or `error`.
 * On Vercel this uses Anakin Search / Google News RSS (never local Chrome).
 */
export async function POST(req: Request) {
  let region = "";
  let topic = "";
  try {
    const body = (await req.json()) as { region?: string; topic?: string };
    region = body.region?.trim() || "";
    topic = body.topic?.trim() || "";
  } catch {
    return new Response(sse({ type: "error", error: "Invalid JSON body" }), {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  }

  if (region.length < 2 || topic.length < 4) {
    return new Response(
      sse({
        type: "error",
        error:
          "Tell us your city/region and a local problem (e.g. Chennai + Metro Phase 2).",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
        },
      },
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (payload: unknown) => {
        try {
          controller.enqueue(enc.encode(sse(payload)));
        } catch {
          /* client disconnected */
        }
      };

      try {
        const { createHyperLocalPrediction } = await import("@/lib/local");
        const bundle = await createHyperLocalPrediction({
          region,
          topic,
          onProgress: (ev) => {
            const full: ResearchProgressEvent = { ...ev, at: Date.now() };
            send({ type: "progress", ...full });
          },
        });

        send({
          type: "result",
          ok: true,
          login: bundle.login,
          question: bundle.question,
          region: bundle.region,
          topic: bundle.topic,
          sharePath: bundle.sharePath,
          sourceUrl: bundle.hit.url,
          sourceHost: bundle.hit.sourceHost,
          summary: bundle.draft?.summary || bundle.hit.summary,
          imageUrl:
            (bundle.hit.imageUrl && bundle.hit.imageUrl.startsWith("http")
              ? bundle.hit.imageUrl
              : null) ||
            (bundle.card.avatarUrl?.startsWith("http") ? bundle.card.avatarUrl : null) ||
            bundle.card.cardImageUrl ||
            null,
          whyItMatters: bundle.draft?.whyItMatters || null,
          category: bundle.draft?.category || bundle.card.market?.category || null,
          card: bundle.card,
          audioUrl: bundle.audioUrl || null,
          reused: Boolean(bundle.reused),
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Research failed";
        console.error("[local/research/stream]", message);
        if (e instanceof Error && e.stack) console.error(e.stack);
        send({ type: "error", error: message });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
