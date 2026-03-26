import { connection } from "next/server";

import { CoinbaseDemo } from "@/components/coinbase-demo";
import { syncRemoteCheckouts } from "@/app/lib/demo-store";

export default async function Home() {
  await connection();

  return <CoinbaseDemo initialState={await syncRemoteCheckouts()} />;
}
