import { NextResponse } from "next/server";

import { syncRemoteCheckouts } from "@/app/lib/demo-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await syncRemoteCheckouts());
}
