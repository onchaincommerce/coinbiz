export const EMBEDDED_WALLET_STATE_EVENT =
  "coinbiz:embedded-wallet-state";

export type EmbeddedWalletSessionState = {
  email: string | null;
  evmAddress: string | null;
  isInitialized: boolean;
  isSignedIn: boolean;
  userId: string | null;
};

declare global {
  interface Window {
    __coinbizEmbeddedWalletState?: EmbeddedWalletSessionState;
  }
}
