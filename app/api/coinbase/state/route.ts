import { NextResponse } from "next/server";

import { getDemoState } from "@/app/lib/demo-store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getDemoState());
}
