export type AgentCheckoutStatus =
  | "created"
  | "payment_submitted"
  | "paid"
  | "failed"
  | "expired"
  | "amount_mismatch";

export type AgentCheckoutWalletProvider =
  | "cdp-server-wallet"
  | "agentic-wallet-cli"
  | "mock";

export type AgentCheckoutNetwork = "base";
export type AgentCheckoutToken = "USDC";

export interface AgentCheckout {
  accountId?: string;
  addressId?: string;
  amountAtomic: string;
  amountUsdc: string;
  chain: AgentCheckoutNetwork;
  chainId: 8453;
  checkoutUrl: string;
  createdAt: string;
  description?: string;
  errorCode?: string;
  errorMessage?: string;
  expiresAt: string;
  id: string;
  lastSyncedAt?: string;
  metadata: Record<string, string>;
  payerAddress?: string;
  paymentRequestSignature: string;
  rawPaymentResponse?: unknown;
  rawSyncResponse?: unknown;
  recipientAddress: string;
  reference: string;
  status: AgentCheckoutStatus;
  token: AgentCheckoutToken;
  tokenAddress: string;
  txHash?: string;
  updatedAt: string;
  walletProvider?: AgentCheckoutWalletProvider;
}

export interface AgentCheckoutPublicView {
  amountAtomic: string;
  amountUsdc: string;
  chain: AgentCheckoutNetwork;
  chainId: 8453;
  checkoutUrl: string;
  createdAt: string;
  description?: string;
  errorCode?: string;
  errorMessage?: string;
  expiresAt: string;
  id: string;
  lastSyncedAt?: string;
  metadata: Record<string, string>;
  payerAddress?: string;
  paymentRequestSignature: string;
  recipientAddress: string;
  reference: string;
  status: AgentCheckoutStatus;
  token: AgentCheckoutToken;
  tokenAddress: string;
  txHash?: string;
  updatedAt: string;
  walletProvider?: AgentCheckoutWalletProvider;
}

export interface AgentChatToolResult {
  name: "inspect_coinbiz_checkout_link" | "pay_coinbiz_checkout" | "sync_coinbiz_checkout";
  result: unknown;
}

export interface AgentChatMessage {
  role: "agent" | "tool";
  content: string;
  toolName?: AgentChatToolResult["name"];
}
