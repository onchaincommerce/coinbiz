import { NextResponse } from "next/server";

import { syncPushCharge } from "@/app/lib/push-payments";
import { verifyPushChargeToken } from "@/app/lib/push-charge-token";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      token?: unknown;
    };

    if (typeof body.token !== "string" || !body.token.trim()) {
      return NextResponse.json(
        { error: "A signed push charge token is required." },
        { status: 400 },
      );
    }

    const payload = verifyPushChargeToken(body.token.trim());
    const charge = await syncPushCharge(payload);

    return NextResponse.json({ charge });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to sync push charge.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
