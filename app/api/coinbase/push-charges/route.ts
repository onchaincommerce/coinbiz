import { NextResponse } from "next/server";

import { createPushCharge } from "@/app/lib/push-payments";
import { signPushChargeToken } from "@/app/lib/push-charge-token";
import type {
  CheckoutEnvironment,
  PushAsset,
  PushNetwork,
} from "@/app/lib/coinbase-types";

export const runtime = "nodejs";

function isEnvironment(value: unknown): value is CheckoutEnvironment {
  return value === "sandbox" || value === "live";
}

function isPushAsset(value: unknown): value is PushAsset {
  return value === "BTC" || value === "ETH";
}

function isPushNetwork(value: unknown): value is PushNetwork {
  return value === "bitcoin" || value === "ethereum" || value === "base";
}

function isAmount(value: unknown): value is string {
  return (
    typeof value === "string" && /^\d+(\.\d{1,2})?$/.test(value) && Number(value) > 0
  );
}

function parseMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entryValue]) =>
      typeof entryValue === "string" && entryValue.trim()
        ? [[key, entryValue.trim()]]
        : [],
    ),
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      amountUsd?: unknown;
      asset?: unknown;
      environment?: unknown;
      metadata?: unknown;
      network?: unknown;
      note?: unknown;
      reference?: unknown;
    };

    if (!isEnvironment(body.environment)) {
      return NextResponse.json(
        { error: "Environment must be either sandbox or live." },
        { status: 400 },
      );
    }

    if (!isPushAsset(body.asset)) {
      return NextResponse.json(
        { error: "Asset must be BTC or ETH." },
        { status: 400 },
      );
    }

    if (body.network !== undefined && !isPushNetwork(body.network)) {
      return NextResponse.json(
        { error: "Network must be bitcoin, ethereum, or base." },
        { status: 400 },
      );
    }

    if (!isAmount(body.amountUsd)) {
      return NextResponse.json(
        { error: "amountUsd must be a string with up to two decimal places." },
        { status: 400 },
      );
    }

    if (typeof body.reference !== "string" || !body.reference.trim()) {
      return NextResponse.json(
        { error: "Reference is required for direct transfers." },
        { status: 400 },
      );
    }

    const { charge, payload } = await createPushCharge({
      amountUsd: body.amountUsd,
      asset: body.asset,
      environment: body.environment,
      metadata: parseMetadata(body.metadata),
      network: body.network,
      note: typeof body.note === "string" ? body.note.trim() : undefined,
      reference: body.reference.trim(),
    });
    const token = signPushChargeToken(payload);

    return NextResponse.json(
      {
        charge,
        token,
      },
      { status: 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to create push charge.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
