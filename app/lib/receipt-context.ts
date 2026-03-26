import type {
  CheckoutEnvironment,
  CoinbaseCheckout,
} from "@/app/lib/coinbase-types";

export type StoredReceiptContext = {
  amount: string;
  checkoutId: string;
  checkoutUrl: string;
  createdAt?: string;
  currency: string;
  environment: CheckoutEnvironment;
  metadata?: Record<string, string>;
};

const RECEIPT_COOKIE_PREFIX = "coinbiz_receipt";

export function getReceiptCookieName(environment: CheckoutEnvironment) {
  return `${RECEIPT_COOKIE_PREFIX}_${environment}`;
}

export function buildStoredReceiptContext(
  checkout: CoinbaseCheckout,
  environment: CheckoutEnvironment,
): StoredReceiptContext {
  return {
    amount: checkout.amount,
    checkoutId: checkout.id,
    checkoutUrl: checkout.url,
    createdAt: checkout.createdAt,
    currency: checkout.currency,
    environment,
    metadata: checkout.metadata,
  };
}

export function serializeReceiptContext(context: StoredReceiptContext) {
  return encodeURIComponent(JSON.stringify(context));
}

export function deserializeReceiptContext(value?: string) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(decodeURIComponent(value)) as StoredReceiptContext;
  } catch {
    return null;
  }
}
