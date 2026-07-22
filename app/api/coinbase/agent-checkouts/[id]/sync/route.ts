import { NextResponse } from "next/server";

import { syncAgentCheckout } from "@/app/lib/agent-checkouts";
import { toAgentCheckoutPublicView } from "@/app/lib/agent-checkout-policy";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const checkout = await syncAgentCheckout(id);

    return NextResponse.json({
      checkout: toAgentCheckoutPublicView(checkout),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to sync agent checkout.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
