import { createHyperLocalPrediction } from "@/lib/local";
import type { ResearchProgressEvent } from "@/lib/local/progress";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Live research stream — emits progress steps, then a final `result` or `error`.
 * POST body: { region, topic }
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
      status: 400,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  if (region.length < 2 || topic.length < 4) {
    return new Response(
      sse({
        type: "error",
        error:
          "Tell us your city/region and a local problem (e.g. Chennai + Metro Phase 2).",
      }),
      { status: 400, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (payload: unknown) => {
        controller.enqueue(enc.encode(sse(payload)));
      };

      try {
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
          imageUrl: bundle.card.cardImageUrl || bundle.hit.imageUrl,
          whyItMatters: bundle.draft?.whyItMatters || null,
          category: bundle.draft?.category || bundle.card.market?.category || null,
          card: bundle.card,
          audioUrl: bundle.audioUrl || null,
          reused: Boolean(bundle.reused),
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Research failed";
        console.error("[local/research/stream]", message);
        send({ type: "error", error: message });
      } finally {
        controller.close();
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
