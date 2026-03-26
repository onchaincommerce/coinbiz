import { NextResponse } from "next/server";

import { createCheckout } from "@/app/lib/coinbase";
import type { CheckoutEnvironment } from "@/app/lib/coinbase-types";
import { getDemoState, recordCheckoutCreated } from "@/app/lib/demo-store";

export const runtime = "nodejs";

function isEnvironment(value: unknown): value is CheckoutEnvironment {
  return value === "sandbox" || value === "live";
}

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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      amount?: unknown;
      description?: unknown;
      environment?: unknown;
      expiresAt?: unknown;
      failRedirectUrl?: unknown;
      metadata?: unknown;
      successRedirectUrl?: unknown;
    };

    if (!isEnvironment(body.environment)) {
      return NextResponse.json(
        { error: "Environment must be either sandbox or live." },
        { status: 400 },
      );
    }

    if (!isAmount(body.amount)) {
      return NextResponse.json(
        { error: "Amount must be a string with up to two decimal places." },
        { status: 400 },
      );
    }

    const checkout = await createCheckout({
      amount: body.amount,
      description:
        typeof body.description === "string" ? body.description.trim() : undefined,
      environment: body.environment,
      expiresAt:
        typeof body.expiresAt === "string" ? body.expiresAt.trim() : undefined,
      failRedirectUrl:
        typeof body.failRedirectUrl === "string"
          ? body.failRedirectUrl.trim()
          : undefined,
      metadata: parseMetadata(body.metadata),
      successRedirectUrl:
        typeof body.successRedirectUrl === "string"
          ? body.successRedirectUrl.trim()
          : undefined,
    });

    const checkoutWithEnvironment = {
      ...checkout,
      demoEnvironment: body.environment,
    };

    recordCheckoutCreated(body.environment, checkoutWithEnvironment);

    return NextResponse.json(
      {
        checkout: checkoutWithEnvironment,
        demoState: getDemoState(),
      },
      { status: 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to create checkout.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
