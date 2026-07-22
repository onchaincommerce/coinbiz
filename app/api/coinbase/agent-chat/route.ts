import { NextResponse } from "next/server";

import { handleAgentChatMessage } from "@/app/lib/agent-checkouts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      autoPay?: unknown;
      message?: unknown;
    };

    if (typeof body.message !== "string" || !body.message.trim()) {
      return NextResponse.json(
        { error: "message is required." },
        { status: 400 },
      );
    }

    return NextResponse.json(
      await handleAgentChatMessage({
        autoPay: body.autoPay === true,
        message: body.message.trim(),
      }),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to run agent chat.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
