export type CheckoutEnvironment = "sandbox" | "live";

export interface CheckoutSettlement {
  currency: string;
  feeAmount: string;
  netAmount: string;
  totalAmount: string;
}

export interface CoinbaseCheckout {
  address?: string;
  amount: string;
  createdAt?: string;
  currency: string;
  demoEnvironment?: CheckoutEnvironment;
  description?: string;
  eventType?: string;
  expiresAt?: string;
  failRedirectUrl?: string;
  fiatAmount?: string;
  fiatCurrency?: string;
  id: string;
  metadata?: Record<string, string>;
  network: string;
  refundedAmount?: string;
  settlement?: CheckoutSettlement;
  status: string;
  successRedirectUrl?: string;
  tokenAddress?: string;
  transactionHash?: string;
  updatedAt?: string;
  url: string;
}

export interface CoinbaseCheckoutListResponse {
  checkouts: CoinbaseCheckout[];
  nextPageToken?: string;
}

export interface DemoEventRecord {
  amount: string;
  checkoutId: string;
  environment: CheckoutEnvironment;
  id: string;
  message: string;
  occurredAt: string;
  status: string;
  title: string;
}

export interface DemoStatePayload {
  checkouts: CoinbaseCheckout[];
  credentialsConfigured: boolean;
  events: DemoEventRecord[];
  lastUpdatedAt: string | null;
  webhookPaths: Record<CheckoutEnvironment, string>;
  webhookSecretsConfigured: Record<CheckoutEnvironment, boolean>;
}
