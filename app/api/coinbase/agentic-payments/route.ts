import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

import { listAgentCheckoutPaymentAttempts } from "@/app/lib/agentic-payment-store";
import { startAgenticCheckoutPayment } from "@/app/lib/headless-checkout-payer";

export const runtime = "nodejs";

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function getBearerToken(request: Request) {
  const header = request.headers.get("authorization")?.trim() ?? "";
  const [scheme, token] = header.split(/\s+/, 2);

  return scheme?.toLowerCase() === "bearer" ? token ?? "" : "";
}

function timingSafeStringEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export async function GET(request: NextRequest) {
  const checkoutId = request.nextUrl.searchParams.get("checkoutId")?.trim();
  const id = request.nextUrl.searchParams.get("id")?.trim();
  const attempts = await listAgentCheckoutPaymentAttempts();

  if (id) {
    return NextResponse.json({
      attempt: attempts.find((attempt) => attempt.id === id) ?? null,
    });
  }

  if (checkoutId) {
    return NextResponse.json({
      attempt: attempts.find((attempt) => attempt.checkoutId === checkoutId) ?? null,
    });
  }

  return NextResponse.json({ attempts });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      checkoutId?: unknown;
      checkoutUrl?: unknown;
      dryRun?: unknown;
      maxPollAttempts?: unknown;
      payerAddress?: unknown;
      pollIntervalMs?: unknown;
      retryFailed?: unknown;
      signature?: unknown;
      waitForCompletion?: unknown;
    };
    const isDryRun = isBoolean(body.dryRun) ? body.dryRun : false;
    const hasExternalSignature =
      typeof body.payerAddress === "string" &&
      Boolean(body.payerAddress.trim()) &&
      typeof body.signature === "string" &&
      Boolean(body.signature.trim());

    if (!isDryRun && !hasExternalSignature) {
      const bearerToken = getBearerToken(request);

      if (!bearerToken) {
        return NextResponse.json(
          { error: "Internal authorization is required for headless payments." },
          { status: 401 },
        );
      }

      const configuredToken = process.env.HEADLESS_PAYMENT_INTERNAL_TOKEN?.trim();

      if (!configuredToken) {
        return NextResponse.json(
          {
            error:
              "HEADLESS_PAYMENT_INTERNAL_TOKEN must be configured before server-signer headless payments can run.",
          },
          { status: 500 },
        );
      }

      if (!timingSafeStringEqual(bearerToken, configuredToken)) {
        return NextResponse.json(
          { error: "Internal authorization is required for headless payments." },
          { status: 401 },
        );
      }
    }

    const attempt = await startAgenticCheckoutPayment({
      checkoutId:
        typeof body.checkoutId === "string" ? body.checkoutId.trim() : undefined,
      checkoutUrl:
        typeof body.checkoutUrl === "string" ? body.checkoutUrl.trim() : undefined,
      dryRun: isBoolean(body.dryRun) ? body.dryRun : undefined,
      maxPollAttempts: isInteger(body.maxPollAttempts)
        ? body.maxPollAttempts
        : undefined,
      payerAddress:
        typeof body.payerAddress === "string" ? body.payerAddress.trim() : undefined,
      pollIntervalMs: isInteger(body.pollIntervalMs)
        ? body.pollIntervalMs
        : undefined,
      retryFailed: isBoolean(body.retryFailed) ? body.retryFailed : undefined,
      signature:
        typeof body.signature === "string" ? body.signature.trim() : undefined,
      waitForCompletion: isBoolean(body.waitForCompletion)
        ? body.waitForCompletion
        : undefined,
    });

    const status =
      attempt.stage === "completed"
        ? 200
        : attempt.stage === "failed"
          ? 409
          : 202;

    return NextResponse.json({ attempt }, { status });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to run agentic payment.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
