import { NextRequest, NextResponse } from "next/server";

import { getCheckout } from "@/app/lib/coinbase";
import type { CheckoutEnvironment } from "@/app/lib/coinbase-types";
import { getDemoState, hydrateCheckout } from "@/app/lib/demo-store";

export const runtime = "nodejs";

function isEnvironment(value: string | null): value is CheckoutEnvironment {
  return value === "sandbox" || value === "live";
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ checkoutId: string }> },
) {
  const { checkoutId } = await context.params;
  const environment = request.nextUrl.searchParams.get("environment");

  if (!isEnvironment(environment)) {
    return NextResponse.json(
      { error: "Provide ?environment=sandbox or ?environment=live." },
      { status: 400 },
    );
  }

  try {
    const checkout = await getCheckout(checkoutId, environment);
    const checkoutWithEnvironment = {
      ...checkout,
      demoEnvironment: environment,
    };

    hydrateCheckout(environment, checkoutWithEnvironment);

    return NextResponse.json({
      checkout: checkoutWithEnvironment,
      demoState: getDemoState(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load checkout.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
