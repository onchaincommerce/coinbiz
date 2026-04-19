import {
  subscribeToDemoState,
  syncRemoteCheckouts,
} from "@/app/lib/demo-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const encoder = new TextEncoder();

function encodeEvent(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function GET(request: Request) {
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let unsubscribe = () => {};

      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        clearInterval(heartbeat);
        unsubscribe();

        try {
          controller.close();
        } catch {
          // The stream may already be closed by the runtime.
        }
      };

      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) {
          return;
        }

        try {
          controller.enqueue(chunk);
        } catch {
          close();
        }
      };

      const heartbeat = setInterval(() => {
        safeEnqueue(encoder.encode(`: heartbeat ${Date.now()}\n\n`));
      }, 15000);

      unsubscribe = subscribeToDemoState((state) => {
        safeEnqueue(encodeEvent("update", state));
      });

      safeEnqueue(encodeEvent("snapshot", await syncRemoteCheckouts()));
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
