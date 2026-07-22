import { NextResponse } from "next/server";

import {
  getAgentCommerceErrorStatus,
  requireAgentCommerceAuth,
} from "@/app/lib/agent-commerce-auth";
import { crawlPurchaseUrl } from "@/app/lib/agent-commerce";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    requireAgentCommerceAuth(request);

    const body = (await request.json()) as {
      url?: unknown;
    };

    if (typeof body.url !== "string" || !body.url.trim()) {
      return NextResponse.json({ error: "url is required." }, { status: 400 });
    }

    return NextResponse.json({
      crawl: await crawlPurchaseUrl(body.url.trim()),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to crawl purchase link.";

    return NextResponse.json(
      { error: message },
      { status: getAgentCommerceErrorStatus(error) },
    );
  }
}
