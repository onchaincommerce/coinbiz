import { NextResponse } from "next/server";

import { inspectAgentCheckout } from "@/app/lib/agent-checkouts";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    return NextResponse.json({
      checkout: await inspectAgentCheckout(id),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load agent checkout.";

    return NextResponse.json({ error: message }, { status: 404 });
  }
}
