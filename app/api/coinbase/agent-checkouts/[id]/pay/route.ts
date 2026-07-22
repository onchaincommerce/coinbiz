import { NextResponse } from "next/server";

import { payAgentCheckout } from "@/app/lib/agent-checkouts";
import { toAgentCheckoutPublicView } from "@/app/lib/agent-checkout-policy";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  try {
    const checkout = await payAgentCheckout(id);
    const status =
      checkout.status === "paid"
        ? 200
        : checkout.status === "payment_submitted"
          ? 202
          : 409;

    return NextResponse.json(
      {
        checkout: toAgentCheckoutPublicView(checkout),
      },
      { status },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to pay agent checkout.";

    return NextResponse.json({ error: message }, { status: 409 });
  }
}
