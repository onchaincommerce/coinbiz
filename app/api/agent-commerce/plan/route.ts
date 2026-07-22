import { NextResponse } from "next/server";

import {
  getAgentCommerceErrorStatus,
  requireAgentCommerceAuth,
} from "@/app/lib/agent-commerce-auth";
import { planExternalPurchase } from "@/app/lib/agent-commerce";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireAgentCommerceAuth(request);

    const body = (await request.json()) as {
      url?: unknown;
      userIntent?: unknown;
    };

    if (typeof body.url !== "string" || !body.url.trim()) {
      return NextResponse.json({ error: "url is required." }, { status: 400 });
    }

    return NextResponse.json({
      plan: await planExternalPurchase({
        url: body.url.trim(),
        userIntent:
          typeof body.userIntent === "string" ? body.userIntent.trim() : undefined,
      }),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to plan purchase.";

    return NextResponse.json(
      { error: message },
      { status: getAgentCommerceErrorStatus(error) },
    );
  }
}
