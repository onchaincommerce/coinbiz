import { getDemoState, subscribeToDemoState } from "@/app/lib/demo-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const encoder = new TextEncoder();

function encodeEvent(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(request: Request) {
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const heartbeat = setInterval(() => {
        if (!closed) {
          controller.enqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
        }
      }, 15000);

      const unsubscribe = subscribeToDemoState((state) => {
        if (!closed) {
          controller.enqueue(encodeEvent("update", state));
        }
      });

      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        controller.close();
      };

      controller.enqueue(encodeEvent("snapshot", getDemoState()));
      request.signal.addEventListener("abort", close, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
