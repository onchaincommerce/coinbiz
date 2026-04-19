export type CheckoutEnvironment = "sandbox" | "live";
export type PaymentRail = "checkout" | "push";
export type PushAsset = "BTC" | "ETH";
export type PushNetwork = "bitcoin" | "ethereum" | "base";
export type PushChargeStatus =
  | "awaiting_payment"
  | "partial"
  | "paid"
  | "expired"
  | "late_payment"
  | "amount_mismatch"
  | "unsupported";

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

export interface CoinbaseMoney {
  amount: string;
  currency: string;
}

export interface CoinbaseAppCurrency {
  code: string;
  exponent: number;
  name: string;
  type: string;
}

export interface CoinbaseAppAccount {
  allowDeposits: boolean;
  allowWithdrawals: boolean;
  balance: CoinbaseMoney;
  createdAt?: string;
  currency: CoinbaseAppCurrency;
  id: string;
  name: string;
  portfolioId?: string;
  primary: boolean;
  resourcePath?: string;
  type: string;
  updatedAt?: string;
}

export interface CoinbaseExchangeRates {
  currency: string;
  rates: Record<string, string>;
}

export interface CoinbaseAddressResource {
  address: string;
  createdAt?: string;
  id: string;
  name?: string | null;
  network?: string | null;
  resourcePath?: string;
  updatedAt?: string;
}

export interface CoinbaseNetworkDetail {
  hash?: string;
  networkName?: string;
  status?: string;
}

export interface CoinbaseTransactionParty {
  address?: string;
  id?: string;
  resource?: string | null;
  resourcePath?: string;
}

export interface CoinbaseTransaction {
  amount: CoinbaseMoney;
  createdAt?: string;
  from?: CoinbaseTransactionParty;
  id: string;
  nativeAmount?: CoinbaseMoney;
  network?: CoinbaseNetworkDetail;
  resourcePath?: string;
  status: string;
  to?: CoinbaseTransactionParty;
  type: string;
  updatedAt?: string;
}

export interface PushChargePaymentSummary {
  expiresAt: string;
  latestTransactionHash?: string;
  latestTransactionId?: string;
  latestTransactionAt?: string;
  matchedAmount: string;
  pendingReceivedAmount: string;
  pendingTransactionCount: number;
  totalReceivedAmount: string;
  transactionCount: number;
}

export interface PushChargeTimelineEntry {
  detail: string;
  id: string;
  occurredAt?: string;
  title: string;
}

export interface PushChargeView {
  accountId: string;
  address: string;
  addressId: string;
  amountUsd: string;
  asset: PushAsset;
  createdAt: string;
  environment: CheckoutEnvironment;
  metadata: Record<string, string>;
  network: PushNetwork;
  note?: string;
  payment: PushChargePaymentSummary;
  quoteExpiresAt: string;
  quoteRateUsd: string;
  quotedAmount: string;
  reference: string;
  status: PushChargeStatus;
  timeline: PushChargeTimelineEntry[];
  token?: string;
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
