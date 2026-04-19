import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";

import {
  getLatestAgentCheckoutPaymentAttemptByCheckoutId,
  listAgentCheckoutPaymentAttempts,
  upsertAgentCheckoutPaymentAttempt,
} from "@/app/lib/agentic-payment-store";
import { getCheckout } from "@/app/lib/coinbase";
import type { CoinbaseCheckout } from "@/app/lib/coinbase-types";
import { startAgenticCheckoutPayment } from "@/app/lib/headless-checkout-payer";
import {
  getLatestCoinbaseWebhookCheckout,
  listLatestCoinbaseWebhookCheckouts,
} from "@/app/lib/webhook-event-store";
import type {
  AgentCheckoutPaymentAttempt,
  AgentCheckoutPaymentStage,
} from "@/app/lib/agentic-payment-types";

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

function getStageFromCheckoutStatus(
  checkout: CoinbaseCheckout,
  fallbackStage: AgentCheckoutPaymentStage = "submitted",
): AgentCheckoutPaymentStage {
  const status = checkout.status.toUpperCase();

  if (status === "COMPLETED") {
    return "completed";
  }

  if (["CANCELED", "CANCELLED", "EXPIRED", "FAILED"].includes(status)) {
    return "failed";
  }

  return fallbackStage;
}

function makeReceiptAttemptFromCheckout(
  checkout: CoinbaseCheckout,
  existingAttempt?: AgentCheckoutPaymentAttempt | null,
): AgentCheckoutPaymentAttempt {
  const now = new Date().toISOString();
  const stage = getStageFromCheckoutStatus(checkout, existingAttempt?.stage);
  const createdAt = existingAttempt?.createdAt ?? checkout.createdAt ?? now;
  const updatedAt = checkout.updatedAt ?? now;

  return {
    amount: checkout.amount,
    checkoutId: checkout.id,
    checkoutUrl: checkout.url,
    correlationId: existingAttempt?.correlationId ?? crypto.randomUUID(),
    createdAt,
    environment: "live",
    errorCode: stage === "failed" ? checkout.status : existingAttempt?.errorCode,
    errorMessage:
      stage === "failed"
        ? `Checkout finished in ${checkout.status}.`
        : existingAttempt?.errorMessage,
    id: existingAttempt?.id ?? `receipt-${checkout.id}`,
    lastReconciledAt: now,
    network: "base",
    payerAddress: existingAttempt?.payerAddress,
    paymentInfo: existingAttempt?.paymentInfo,
    rawCheckoutStatus: checkout,
    rawHostedPayload: existingAttempt?.rawHostedPayload,
    rawSubmissionResponse: existingAttempt?.rawSubmissionResponse,
    signatureRef: existingAttempt?.signatureRef,
    stage,
    submissionEndpoint: existingAttempt?.submissionEndpoint,
    submissionRequestId: existingAttempt?.submissionRequestId,
    token: "USDC",
    tokenCollector: existingAttempt?.tokenCollector,
    txHash: checkout.transactionHash ?? existingAttempt?.txHash,
    updatedAt,
    version: existingAttempt?.version,
  };
}

function shouldUseCheckoutReceipt(
  checkout: CoinbaseCheckout | null,
  attempt?: AgentCheckoutPaymentAttempt | null,
) {
  if (!checkout) {
    return false;
  }

  return !attempt || attempt.stage === "submitted" || attempt.stage === "signed";
}

async function resolveAttemptReceipt(checkoutId: string) {
  const existingAttempt =
    await getLatestAgentCheckoutPaymentAttemptByCheckoutId(checkoutId);
  const webhookCheckout = await getLatestCoinbaseWebhookCheckout({
    checkoutId,
    environment: "live",
  });

  if (webhookCheckout && shouldUseCheckoutReceipt(webhookCheckout, existingAttempt)) {
    const receiptAttempt = makeReceiptAttemptFromCheckout(
      webhookCheckout,
      existingAttempt,
    );
    await upsertAgentCheckoutPaymentAttempt(receiptAttempt);
    return receiptAttempt;
  }

  if (existingAttempt && existingAttempt.stage !== "submitted") {
    return existingAttempt;
  }

  try {
    const officialCheckout = await getCheckout(checkoutId, "live");

    if (shouldUseCheckoutReceipt(officialCheckout, existingAttempt)) {
      const receiptAttempt = makeReceiptAttemptFromCheckout(
        officialCheckout,
        existingAttempt,
      );
      await upsertAgentCheckoutPaymentAttempt(receiptAttempt);
      return receiptAttempt;
    }
  } catch (error) {
    console.error("Unable to reconcile checkout receipt from Coinbase", error);
  }

  return existingAttempt ?? null;
}

async function listAttemptReceipts() {
  const attempts = await listAgentCheckoutPaymentAttempts();
  const latestByCheckoutId = new Map(
    attempts.map((attempt) => [attempt.checkoutId, attempt]),
  );

  try {
    const webhookCheckouts = await listLatestCoinbaseWebhookCheckouts({
      environment: "live",
    });

    for (const checkout of webhookCheckouts) {
      const existingAttempt = latestByCheckoutId.get(checkout.id);

      if (!shouldUseCheckoutReceipt(checkout, existingAttempt)) {
        continue;
      }

      latestByCheckoutId.set(
        checkout.id,
        makeReceiptAttemptFromCheckout(checkout, existingAttempt),
      );
    }
  } catch (error) {
    console.error("Unable to merge webhook receipts into attempt list", error);
  }

  return [...latestByCheckoutId.values()].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt ?? left.createdAt);
    const rightTime = Date.parse(right.updatedAt ?? right.createdAt);
    return rightTime - leftTime;
  });
}

export async function GET(request: NextRequest) {
  const checkoutId = request.nextUrl.searchParams.get("checkoutId")?.trim();
  const id = request.nextUrl.searchParams.get("id")?.trim();

  if (checkoutId) {
    return NextResponse.json({
      attempt: await resolveAttemptReceipt(checkoutId),
    });
  }

  const attempts = await listAttemptReceipts();

  if (id) {
    return NextResponse.json({
      attempt: attempts.find((attempt) => attempt.id === id) ?? null,
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
