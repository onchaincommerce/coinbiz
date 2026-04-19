import { connection } from "next/server";

import { CoinbaseDemo } from "@/components/coinbase-demo";
import type { EmbeddedWalletPanelConfig } from "@/components/cdp-embedded-wallet-panel";
import { syncRemoteCheckouts } from "@/app/lib/demo-store";

export default async function Home() {
  await connection();

  const embeddedWalletConfig: EmbeddedWalletPanelConfig = {
    appLogoUrl: process.env.NEXT_PUBLIC_CDP_APP_LOGO_URL?.trim() || undefined,
    appName: process.env.NEXT_PUBLIC_CDP_APP_NAME?.trim() || "Coinbiz",
    projectId: process.env.NEXT_PUBLIC_CDP_PROJECT_ID?.trim() || "",
  };

  return (
    <CoinbaseDemo
      embeddedWalletConfig={embeddedWalletConfig}
      initialState={await syncRemoteCheckouts()}
    />
  );
}
