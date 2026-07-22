import { NextResponse } from "next/server";

import {
  getAgentCommerceErrorStatus,
  requireAgentCommerceAuth,
} from "@/app/lib/agent-commerce-auth";
import { payExternalPurchase } from "@/app/lib/agent-commerce";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireAgentCommerceAuth(request);

    const body = (await request.json()) as {
      checkoutId?: unknown;
      url?: unknown;
    };
    const checkoutId =
      typeof body.checkoutId === "string" ? body.checkoutId.trim() : undefined;
    const url = typeof body.url === "string" ? body.url.trim() : undefined;

    if (!checkoutId && !url) {
      return NextResponse.json(
        { error: "checkoutId or url is required." },
        { status: 400 },
      );
    }

    return NextResponse.json({
      checkout: await payExternalPurchase({
        checkoutId,
        url,
      }),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to pay purchase link.";
    const authStatus = getAgentCommerceErrorStatus(error, 0);

    return NextResponse.json(
      { error: message },
      { status: authStatus || 409 },
    );
  }
}
