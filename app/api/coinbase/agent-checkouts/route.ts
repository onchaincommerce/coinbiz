import { NextResponse } from "next/server";

import {
  createAgentCheckout,
  listAgentCheckoutPublicViews,
} from "@/app/lib/agent-checkouts";
import { toAgentCheckoutPublicView } from "@/app/lib/agent-checkout-policy";

export const runtime = "nodejs";

function isAmount(value: unknown): value is string {
  return (
    typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value) && Number(value) > 0
  );
}

function parseMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const metadata = Object.fromEntries(
    Object.entries(value).flatMap(([key, entryValue]) =>
      typeof entryValue === "string" && entryValue.trim()
        ? [[key, entryValue.trim()]]
        : [],
    ),
  );

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function getBaseUrl(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.BASE_URL?.trim();

  if (configured) {
    return configured;
  }

  return new URL(request.url).origin;
}

export async function GET() {
  return NextResponse.json({
    checkouts: await listAgentCheckoutPublicViews(),
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      amountUsdc?: unknown;
      description?: unknown;
      metadata?: unknown;
      reference?: unknown;
    };

    if (!isAmount(body.amountUsdc)) {
      return NextResponse.json(
        { error: "amountUsdc must be a positive string with up to two decimals." },
        { status: 400 },
      );
    }

    const checkout = await createAgentCheckout({
      amountUsdc: body.amountUsdc,
      baseUrl: getBaseUrl(request),
      description:
        typeof body.description === "string" ? body.description.trim() : undefined,
      metadata: parseMetadata(body.metadata),
      reference: typeof body.reference === "string" ? body.reference.trim() : undefined,
    });

    return NextResponse.json(
      {
        checkout: toAgentCheckoutPublicView(checkout),
      },
      { status: 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to create agent checkout.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
