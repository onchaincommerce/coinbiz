import { NextResponse } from "next/server";

import {
  getWebhookPath,
  getWebhookSecret,
  verifyWebhookSignature,
} from "@/app/lib/coinbase";
import type {
  CheckoutEnvironment,
  CoinbaseCheckout,
} from "@/app/lib/coinbase-types";
import { getDemoState, recordCheckoutWebhook } from "@/app/lib/demo-store";

export const runtime = "nodejs";

function isEnvironment(value: string): value is CheckoutEnvironment {
  return value === "sandbox" || value === "live";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ environment: string }> },
) {
  const { environment } = await context.params;

  if (!isEnvironment(environment)) {
    return NextResponse.json({ error: "Unknown environment." }, { status: 404 });
  }

  return NextResponse.json({
    configured: Boolean(getWebhookSecret(environment)),
    environment,
    path: getWebhookPath(environment),
    url: request.url,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ environment: string }> },
) {
  const { environment } = await context.params;

  if (!isEnvironment(environment)) {
    return NextResponse.json({ error: "Unknown environment." }, { status: 404 });
  }

  const secret = getWebhookSecret(environment);

  if (!secret) {
    return NextResponse.json(
      {
        error: `Set COINBASE_WEBHOOK_${environment.toUpperCase()}_SECRET before receiving signed webhooks.`,
      },
      { status: 500 },
    );
  }

  const signature = request.headers.get("x-hook0-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing X-Hook0-Signature header." },
      { status: 400 },
    );
  }

  const payload = await request.text();
  const isValid = verifyWebhookSignature({
    headers: request.headers,
    payload,
    secret,
    signatureHeader: signature,
  });

  if (!isValid) {
    return NextResponse.json(
      { error: "Invalid webhook signature." },
      { status: 400 },
    );
  }

  try {
    const checkout = JSON.parse(payload) as CoinbaseCheckout;
    const checkoutWithEnvironment = {
      ...checkout,
      demoEnvironment: environment,
    };

    recordCheckoutWebhook(environment, checkoutWithEnvironment);

    return NextResponse.json({
      checkoutId: checkout.id,
      demoState: getDemoState(),
      environment,
      received: true,
      status: checkout.status,
    });
  } catch {
    return NextResponse.json(
      { error: "Webhook payload was not valid JSON." },
      { status: 400 },
    );
  }
}
