import crypto from "node:crypto";

import type { CoinbaseTransaction } from "@/app/lib/coinbase-types";
import {
  createOnchainAddress,
  listAddressTransactions,
  listWalletAccounts,
} from "@/app/lib/coinbase";
import type {
  AgentChatMessage,
  AgentChatToolResult,
  AgentCheckout,
} from "@/app/lib/agent-checkout-types";
import {
  AGENT_CHECKOUT_CHAIN,
  AGENT_CHECKOUT_CHAIN_ID,
  AGENT_CHECKOUT_TOKEN,
  AGENT_CHECKOUT_USDC_ADDRESS,
  AGENT_CHECKOUT_USDC_DECIMALS,
  decimalToAtomicUnits,
  enforceAgentCheckoutPolicy,
  getAgentCheckoutExpiryMinutes,
  normalizeAgentCheckoutAddress,
  normalizeAgentCheckoutAmount,
  parseAtomicUnits,
  signAgentCheckoutPaymentRequest,
  toAgentCheckoutPublicView,
} from "@/app/lib/agent-checkout-policy";
import {
  getAgentCheckoutById,
  listAgentCheckouts,
  upsertAgentCheckout,
} from "@/app/lib/agent-checkout-store";
import { getAgentWalletProvider } from "@/app/lib/agent-wallet";

type CreateAgentCheckoutInput = {
  amountUsdc: string;
  baseUrl: string;
  description?: string;
  metadata?: Record<string, string>;
  reference?: string;
};

type MerchantRecipient = {
  accountId?: string;
  addressId?: string;
  recipientAddress: string;
};

const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function formatUnits(value: bigint, decimals: number) {
  const base = BigInt(10) ** BigInt(decimals);
  const whole = value / base;
  const fraction = value % base;

  if (fraction === BigInt(0)) {
    return whole.toString();
  }

  return `${whole.toString()}.${fraction
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "")}`;
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function parseMetadata(value: Record<string, string> | undefined) {
  if (!value) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entryValue]) =>
      key.trim() && entryValue.trim()
        ? [[key.trim(), entryValue.trim()]]
        : [],
    ),
  );
}

async function resolveMerchantRecipient(
  reference: string,
): Promise<MerchantRecipient> {
  const configuredRecipient = process.env.AGENT_CHECKOUT_RECIPIENT_ADDRESS?.trim();

  if (configuredRecipient) {
    return {
      recipientAddress: normalizeAgentCheckoutAddress(configuredRecipient),
    };
  }

  const accounts = await listWalletAccounts();
  const usdcAccount = accounts.find(
    (candidate) =>
      candidate.type === "wallet" &&
      candidate.allowDeposits &&
      candidate.currency.code.toUpperCase() === AGENT_CHECKOUT_TOKEN,
  );

  if (!usdcAccount) {
    throw new Error(
      "Agent checkout requires AGENT_CHECKOUT_RECIPIENT_ADDRESS or a deposit-enabled USDC Coinbase account.",
    );
  }

  const receiveAddress = await createOnchainAddress({
    accountId: usdcAccount.id,
    name: `Coinbiz Agent ${reference}`,
    network: AGENT_CHECKOUT_CHAIN,
  });

  return {
    accountId: usdcAccount.id,
    addressId: receiveAddress.id,
    recipientAddress: normalizeAgentCheckoutAddress(receiveAddress.address),
  };
}

export async function createAgentCheckout(input: CreateAgentCheckoutInput) {
  const amountUsdc = normalizeAgentCheckoutAmount(input.amountUsdc);
  const amountAtomic = decimalToAtomicUnits(amountUsdc, AGENT_CHECKOUT_USDC_DECIMALS);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + getAgentCheckoutExpiryMinutes() * 60 * 1000,
  ).toISOString();
  const reference = input.reference?.trim() || `agent-${Date.now()}`;
  const merchantRecipient = await resolveMerchantRecipient(reference);
  const checkoutUrl = `${normalizeBaseUrl(input.baseUrl)}/agent-checkout/${id}`;
  const checkoutWithoutSignature = {
    accountId: merchantRecipient.accountId,
    addressId: merchantRecipient.addressId,
    amountAtomic,
    amountUsdc,
    chain: AGENT_CHECKOUT_CHAIN,
    chainId: AGENT_CHECKOUT_CHAIN_ID,
    checkoutUrl,
    createdAt,
    description: input.description?.trim() || undefined,
    expiresAt,
    id,
    metadata: parseMetadata(input.metadata),
    paymentRequestSignature: "",
    recipientAddress: merchantRecipient.recipientAddress,
    reference,
    status: "created",
    token: AGENT_CHECKOUT_TOKEN,
    tokenAddress: AGENT_CHECKOUT_USDC_ADDRESS,
    updatedAt: createdAt,
  } satisfies AgentCheckout;
  const checkout = {
    ...checkoutWithoutSignature,
    paymentRequestSignature: signAgentCheckoutPaymentRequest(checkoutWithoutSignature),
  } satisfies AgentCheckout;

  return upsertAgentCheckout(checkout);
}

export async function getAgentCheckoutOrThrow(id: string) {
  const checkout = await getAgentCheckoutById(id);

  if (!checkout) {
    throw new Error("Agent checkout was not found.");
  }

  return checkout;
}

function getReceiveTransactions(transactions: CoinbaseTransaction[]) {
  return transactions
    .filter(
      (transaction) =>
        transaction.type === "receive" &&
        transaction.amount.currency.toUpperCase() === AGENT_CHECKOUT_TOKEN,
    )
    .sort((left, right) => {
      const leftTime = Date.parse(left.createdAt ?? "0");
      const rightTime = Date.parse(right.createdAt ?? "0");
      return rightTime - leftTime;
    });
}

function sumCompletedReceives(transactions: CoinbaseTransaction[]) {
  return transactions
    .filter((transaction) => transaction.status === "completed")
    .reduce(
      (total, transaction) =>
        total +
        parseAtomicUnits(
          decimalToAtomicUnits(
            transaction.amount.amount,
            AGENT_CHECKOUT_USDC_DECIMALS,
          ),
        ),
      BigInt(0),
    );
}

export async function syncAgentCheckout(id: string) {
  const checkout = await getAgentCheckoutOrThrow(id);
  const now = new Date().toISOString();

  if (!checkout.accountId || !checkout.addressId) {
    const status =
      checkout.status === "created" && Date.now() > Date.parse(checkout.expiresAt)
        ? "expired"
        : checkout.status;

    return upsertAgentCheckout({
      ...checkout,
      lastSyncedAt: now,
      status,
      updatedAt: now,
    });
  }

  const transactions = await listAddressTransactions({
    accountId: checkout.accountId,
    addressId: checkout.addressId,
  });
  const receiveTransactions = getReceiveTransactions(transactions);
  const totalReceivedAtomic = sumCompletedReceives(receiveTransactions);
  const requiredAtomic = parseAtomicUnits(checkout.amountAtomic);
  const latestReceive = receiveTransactions[0];
  const latestCompletedReceive = receiveTransactions.find(
    (transaction) => transaction.status === "completed",
  );
  let nextStatus: AgentCheckout["status"] = checkout.status;
  let errorCode = checkout.errorCode;
  let errorMessage = checkout.errorMessage;

  if (totalReceivedAtomic === requiredAtomic) {
    nextStatus = "paid";
    errorCode = undefined;
    errorMessage = undefined;
  } else if (totalReceivedAtomic > requiredAtomic) {
    nextStatus = "amount_mismatch";
    errorCode = "amount_mismatch";
    errorMessage = `Received ${formatUnits(
      totalReceivedAtomic,
      AGENT_CHECKOUT_USDC_DECIMALS,
    )} USDC for a ${checkout.amountUsdc} USDC checkout.`;
  } else if (Date.now() > Date.parse(checkout.expiresAt)) {
    nextStatus = "expired";
    errorCode = "expired";
    errorMessage = "Agent checkout expired before exact payment was received.";
  } else if (checkout.status === "payment_submitted") {
    nextStatus = "payment_submitted";
  } else {
    nextStatus = "created";
  }

  return upsertAgentCheckout({
    ...checkout,
    errorCode,
    errorMessage,
    lastSyncedAt: now,
    rawSyncResponse: {
      latestReceive,
      totalReceivedAtomic: totalReceivedAtomic.toString(),
      transactionCount: receiveTransactions.length,
    },
    status: nextStatus,
    txHash:
      latestCompletedReceive?.network?.hash ??
      latestReceive?.network?.hash ??
      checkout.txHash,
    updatedAt: now,
  });
}

export async function payAgentCheckout(id: string) {
  const checkout = await getAgentCheckoutOrThrow(id);

  enforceAgentCheckoutPolicy(checkout);

  const provider = getAgentWalletProvider();
  const payment = await provider.sendUsdc({
    amountUsdc: checkout.amountUsdc,
    chain: checkout.chain,
    checkoutId: checkout.id,
    recipientAddress: checkout.recipientAddress,
  });
  const now = new Date().toISOString();

  await upsertAgentCheckout({
    ...checkout,
    lastSyncedAt: now,
    payerAddress: payment.payerAddress,
    rawPaymentResponse: payment.raw,
    status: "payment_submitted",
    txHash: payment.txHash,
    updatedAt: now,
    walletProvider: payment.provider,
  });

  return syncAgentCheckout(id);
}

export async function inspectAgentCheckout(id: string) {
  const checkout = await getAgentCheckoutOrThrow(id);
  return toAgentCheckoutPublicView(checkout);
}

export async function listAgentCheckoutPublicViews() {
  const checkouts = await listAgentCheckouts();
  return checkouts.map(toAgentCheckoutPublicView);
}

export function extractAgentCheckoutIdFromText(message: string) {
  const urlMatches = message.match(/https?:\/\/[^\s)]+/g) ?? [];

  for (const candidate of urlMatches) {
    try {
      const url = new URL(candidate);
      const segments = url.pathname.split("/").filter(Boolean);
      const agentSegmentIndex = segments.findIndex(
        (segment) => segment === "agent-checkout" || segment === "agent-checkouts",
      );

      if (agentSegmentIndex !== -1) {
        const candidateId = segments[agentSegmentIndex + 1];

        if (candidateId && UUID_PATTERN.test(candidateId)) {
          return candidateId;
        }
      }
    } catch {
      continue;
    }
  }

  const plainIdMatch = message.match(UUID_PATTERN);
  return plainIdMatch?.[0] ?? null;
}

function looksLikeArbitraryStoreLink(message: string) {
  const urlMatches = message.match(/https?:\/\/[^\s)]+/g) ?? [];

  return urlMatches.some((candidate) => {
    try {
      const url = new URL(candidate);
      return !url.pathname.includes("/agent-checkout/");
    } catch {
      return false;
    }
  });
}

function shouldPay(message: string, autoPay: boolean) {
  return autoPay || /\b(pay|purchase|buy|spend|submit)\b/i.test(message);
}

export async function handleAgentChatMessage(input: {
  autoPay?: boolean;
  message: string;
}) {
  const checkoutId = extractAgentCheckoutIdFromText(input.message);
  const messages: AgentChatMessage[] = [];
  const toolResults: AgentChatToolResult[] = [];

  if (!checkoutId) {
    messages.push({
      content: looksLikeArbitraryStoreLink(input.message)
        ? "I can only pay Coinbiz agent-checkout links right now. Create or paste a /agent-checkout/{id} link and I can inspect it against policy."
        : "Send me a Coinbiz agent-checkout link and I can inspect it, pay it under policy, or sync the receipt.",
      role: "agent",
    });

    return { messages, toolResults };
  }

  const inspected = await inspectAgentCheckout(checkoutId);
  toolResults.push({
    name: "inspect_coinbiz_checkout_link",
    result: inspected,
  });

  if (!shouldPay(input.message, Boolean(input.autoPay))) {
    messages.push({
      content: `I inspected checkout ${inspected.id}. It requests ${inspected.amountUsdc} ${inspected.token} on ${inspected.chain} to ${inspected.recipientAddress}. Ask me to pay it if you want the agent wallet to execute within policy.`,
      role: "agent",
    });

    return { messages, toolResults };
  }

  const paid = await payAgentCheckout(checkoutId);
  const paidView = toAgentCheckoutPublicView(paid);
  toolResults.push({
    name: "pay_coinbiz_checkout",
    result: paidView,
  });

  messages.push({
    content:
      paidView.status === "paid"
        ? `Paid checkout ${paidView.id}. Transaction: ${paidView.txHash ?? "pending"}.`
        : `Submitted payment for checkout ${paidView.id}. Current status: ${paidView.status}.`,
    role: "agent",
  });

  return { messages, toolResults };
}
