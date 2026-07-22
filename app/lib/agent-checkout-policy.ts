import crypto from "node:crypto";

import { getAddress, isAddress } from "viem";

import type {
  AgentCheckout,
  AgentCheckoutPublicView,
} from "@/app/lib/agent-checkout-types";

export const AGENT_CHECKOUT_CHAIN = "base" as const;
export const AGENT_CHECKOUT_CHAIN_ID = 8453 as const;
export const AGENT_CHECKOUT_TOKEN = "USDC" as const;
export const AGENT_CHECKOUT_USDC_ADDRESS =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const AGENT_CHECKOUT_USDC_DECIMALS = 6;
export const DEFAULT_AGENT_CHECKOUT_MAX_USDC = "0.01";
export const DEFAULT_AGENT_CHECKOUT_EXPIRY_MINUTES = 15;

type PaymentRequestPayload = Pick<
  AgentCheckout,
  | "amountAtomic"
  | "amountUsdc"
  | "chain"
  | "chainId"
  | "expiresAt"
  | "id"
  | "recipientAddress"
  | "reference"
  | "token"
  | "tokenAddress"
>;

export function normalizeAgentCheckoutAmount(value: string) {
  const amount = Number.parseFloat(value.trim());

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid amount: ${value}`);
  }

  return amount.toFixed(2);
}

export function decimalToAtomicUnits(value: string, decimals: number) {
  const normalizedValue = value.trim();

  if (!/^\d+(\.\d+)?$/.test(normalizedValue)) {
    throw new Error(`Invalid decimal amount: ${value}`);
  }

  const [wholePart, fractionalPart = ""] = normalizedValue.split(".");
  const paddedFractional = `${fractionalPart}${"0".repeat(decimals)}`.slice(
    0,
    decimals,
  );
  const atomicUnits = `${wholePart}${paddedFractional}`.replace(/^0+(?=\d)/, "");

  return atomicUnits || "0";
}

export function parseAtomicUnits(value: string) {
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`Invalid atomic amount: ${value}`);
  }

  return BigInt(value);
}

export function normalizeAgentCheckoutAddress(value: string) {
  if (!isAddress(value)) {
    throw new Error(`Invalid EVM address: ${value}`);
  }

  return getAddress(value);
}

export function getAgentCheckoutMaxUsdc() {
  const configured = process.env.AGENT_CHECKOUT_MAX_USDC?.trim();
  return configured
    ? normalizeAgentCheckoutAmount(configured)
    : DEFAULT_AGENT_CHECKOUT_MAX_USDC;
}

export function getAgentCheckoutExpiryMinutes() {
  const configured = Number.parseInt(
    process.env.AGENT_CHECKOUT_EXPIRY_MINUTES ?? "",
    10,
  );

  return Number.isInteger(configured) && configured > 0
    ? Math.min(configured, 60)
    : DEFAULT_AGENT_CHECKOUT_EXPIRY_MINUTES;
}

function getAgentCheckoutStateSecret() {
  return (
    process.env.AGENT_CHECKOUT_STATE_SECRET?.trim() ||
    process.env.COINBASE_PUSH_STATE_SECRET?.trim() ||
    process.env.CDP_API_KEY_SECRET?.trim() ||
    ""
  );
}

function getPaymentRequestPayload(checkout: PaymentRequestPayload) {
  return {
    amountAtomic: checkout.amountAtomic,
    amountUsdc: checkout.amountUsdc,
    chain: checkout.chain,
    chainId: checkout.chainId,
    expiresAt: checkout.expiresAt,
    id: checkout.id,
    recipientAddress: normalizeAgentCheckoutAddress(checkout.recipientAddress),
    reference: checkout.reference,
    token: checkout.token,
    tokenAddress: normalizeAgentCheckoutAddress(checkout.tokenAddress),
  } satisfies PaymentRequestPayload;
}

function getCanonicalPaymentRequest(checkout: PaymentRequestPayload) {
  return JSON.stringify(getPaymentRequestPayload(checkout));
}

export function signAgentCheckoutPaymentRequest(checkout: PaymentRequestPayload) {
  const secret = getAgentCheckoutStateSecret();

  if (!secret) {
    throw new Error(
      "Agent checkout signing requires AGENT_CHECKOUT_STATE_SECRET, COINBASE_PUSH_STATE_SECRET, or CDP_API_KEY_SECRET.",
    );
  }

  return crypto
    .createHmac("sha256", secret)
    .update(getCanonicalPaymentRequest(checkout), "utf8")
    .digest("hex");
}

export function verifyAgentCheckoutPaymentRequest(checkout: AgentCheckout) {
  const expectedSignature = signAgentCheckoutPaymentRequest(checkout);
  const actualSignature = checkout.paymentRequestSignature;
  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(actualSignature);

  return (
    expectedBuffer.length === actualBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export function enforceAgentCheckoutPolicy(checkout: AgentCheckout) {
  if (checkout.chain !== AGENT_CHECKOUT_CHAIN || checkout.chainId !== AGENT_CHECKOUT_CHAIN_ID) {
    throw new Error("Agent checkout only supports Base mainnet.");
  }

  if (
    checkout.token !== AGENT_CHECKOUT_TOKEN ||
    normalizeAgentCheckoutAddress(checkout.tokenAddress) !==
      normalizeAgentCheckoutAddress(AGENT_CHECKOUT_USDC_ADDRESS)
  ) {
    throw new Error("Agent checkout only supports Base USDC.");
  }

  if (!verifyAgentCheckoutPaymentRequest(checkout)) {
    throw new Error("Agent checkout payment request signature is invalid.");
  }

  if (Date.now() > Date.parse(checkout.expiresAt)) {
    throw new Error("Agent checkout has expired.");
  }

  if (checkout.status === "paid") {
    throw new Error("Agent checkout has already been paid.");
  }

  if (checkout.status === "payment_submitted") {
    throw new Error("Agent checkout payment has already been submitted.");
  }

  const maxAtomic = parseAtomicUnits(
    decimalToAtomicUnits(getAgentCheckoutMaxUsdc(), AGENT_CHECKOUT_USDC_DECIMALS),
  );
  const amountAtomic = parseAtomicUnits(checkout.amountAtomic);

  if (amountAtomic > maxAtomic) {
    throw new Error(
      `Agent checkout amount ${checkout.amountUsdc} USDC exceeds autonomous cap ${getAgentCheckoutMaxUsdc()} USDC.`,
    );
  }
}

export function toAgentCheckoutPublicView(
  checkout: AgentCheckout,
): AgentCheckoutPublicView {
  return {
    amountAtomic: checkout.amountAtomic,
    amountUsdc: checkout.amountUsdc,
    chain: checkout.chain,
    chainId: checkout.chainId,
    checkoutUrl: checkout.checkoutUrl,
    createdAt: checkout.createdAt,
    description: checkout.description,
    errorCode: checkout.errorCode,
    errorMessage: checkout.errorMessage,
    expiresAt: checkout.expiresAt,
    id: checkout.id,
    lastSyncedAt: checkout.lastSyncedAt,
    metadata: checkout.metadata,
    payerAddress: checkout.payerAddress,
    paymentRequestSignature: checkout.paymentRequestSignature,
    recipientAddress: checkout.recipientAddress,
    reference: checkout.reference,
    status: checkout.status,
    token: checkout.token,
    tokenAddress: checkout.tokenAddress,
    txHash: checkout.txHash,
    updatedAt: checkout.updatedAt,
    walletProvider: checkout.walletProvider,
  };
}
