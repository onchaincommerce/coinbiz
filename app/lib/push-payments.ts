import crypto from "node:crypto";

import {
  createOnchainAddress,
  getExchangeRates,
  listAddressTransactions,
  listWalletAccounts,
} from "@/app/lib/coinbase";
import type {
  CheckoutEnvironment,
  CoinbaseTransaction,
  PushAsset,
  PushChargePaymentSummary,
  PushChargeStatus,
  PushChargeTimelineEntry,
  PushChargeView,
  PushNetwork,
} from "@/app/lib/coinbase-types";
import type { PushChargeTokenPayload } from "@/app/lib/push-charge-token";

const PUSH_QUOTE_TTL_MINUTES = 15;

const PUSH_ASSET_CONFIG: Record<
  PushAsset,
  {
    exponent: number;
    supportedNetworks: PushNetwork[];
  }
> = {
  BTC: {
    exponent: 8,
    supportedNetworks: ["bitcoin"],
  },
  ETH: {
    exponent: 8,
    supportedNetworks: ["ethereum", "base"],
  },
};

type CreatePushChargeInput = {
  amountUsd: string;
  asset: PushAsset;
  environment: CheckoutEnvironment;
  metadata: Record<string, string>;
  network?: PushNetwork;
  note?: string;
  reference: string;
};

type PaymentEvaluation = {
  latestCompletedReceive: CoinbaseTransaction | null;
  latestReceive: CoinbaseTransaction | null;
  payment: PushChargePaymentSummary;
  status: PushChargeStatus;
  totalReceivedAmount: string;
};

function getPushAssetConfig(asset: PushAsset) {
  const config = PUSH_ASSET_CONFIG[asset];

  if (!config) {
    throw new Error(`Unsupported push payment asset: ${asset}`);
  }

  return config;
}

function resolvePushNetwork(asset: PushAsset, requestedNetwork?: PushNetwork) {
  const config = getPushAssetConfig(asset);
  const fallbackNetwork = config.supportedNetworks[0];

  if (!requestedNetwork) {
    return fallbackNetwork;
  }

  if (!config.supportedNetworks.includes(requestedNetwork)) {
    throw new Error(`${asset} push payments do not support the ${requestedNetwork} network.`);
  }

  return requestedNetwork;
}

function parseDecimalToUnits(value: string, exponent: number) {
  const normalizedValue = value.trim();

  if (!/^\d+(\.\d+)?$/.test(normalizedValue)) {
    throw new Error(`Invalid decimal amount: ${value}`);
  }

  const [wholePart, fractionalPart = ""] = normalizedValue.split(".");
  const paddedFractional = `${fractionalPart}${"0".repeat(exponent)}`.slice(
    0,
    exponent,
  );

  return BigInt(`${wholePart}${paddedFractional}`.replace(/^0+(?=\d)/, ""));
}

function formatUnits(value: bigint, exponent: number) {
  const negative = value < BigInt(0);
  const absolute = negative ? value * BigInt(-1) : value;
  const base = BigInt(10) ** BigInt(exponent);
  const whole = absolute / base;
  const fraction = absolute % base;

  if (fraction === BigInt(0)) {
    return `${negative ? "-" : ""}${whole.toString()}`;
  }

  const fractionText = fraction.toString().padStart(exponent, "0").replace(/0+$/, "");

  return `${negative ? "-" : ""}${whole.toString()}.${fractionText}`;
}

function roundQuoteAmountUp(amountUsd: string, usdRate: string, exponent: number) {
  const amount = Number.parseFloat(amountUsd);
  const rate = Number.parseFloat(usdRate);

  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(rate) || rate <= 0) {
    throw new Error("Unable to quote the selected push payment asset.");
  }

  const factor = 10 ** exponent;
  const rounded = Math.ceil((amount / rate) * factor) / factor;

  return rounded.toFixed(exponent).replace(/\.?0+$/, "");
}

function sumTransactionUnits(
  transactions: CoinbaseTransaction[],
  exponent: number,
) {
  return transactions.reduce(
    (total, transaction) =>
      total + parseDecimalToUnits(transaction.amount.amount, exponent),
    BigInt(0),
  );
}

function makePaymentSummary(input: {
  latestCompletedReceive: CoinbaseTransaction | null;
  latestReceive: CoinbaseTransaction | null;
  payload: PushChargeTokenPayload;
  pendingReceivedAmount: string;
  pendingTransactionCount: number;
  totalReceivedAmount: string;
  transactionCount: number;
}): PushChargePaymentSummary {
  const latestTransaction = input.latestReceive ?? input.latestCompletedReceive;

  return {
    expiresAt: input.payload.quoteExpiresAt,
    latestTransactionAt: latestTransaction?.createdAt,
    latestTransactionHash: latestTransaction?.network?.hash,
    latestTransactionId: latestTransaction?.id,
    matchedAmount: input.payload.quotedAmount,
    pendingReceivedAmount: input.pendingReceivedAmount,
    pendingTransactionCount: input.pendingTransactionCount,
    totalReceivedAmount: input.totalReceivedAmount,
    transactionCount: input.transactionCount,
  };
}

function evaluatePaymentStatus(
  payload: PushChargeTokenPayload,
  transactions: CoinbaseTransaction[],
): PaymentEvaluation {
  const config = getPushAssetConfig(payload.asset);
  const receiveTransactions = transactions
    .filter(
      (transaction) =>
        transaction.type === "receive" &&
        transaction.amount.currency.toUpperCase() === payload.asset,
    )
    .sort((left, right) => {
      const leftTime = Date.parse(left.createdAt ?? "0");
      const rightTime = Date.parse(right.createdAt ?? "0");
      return rightTime - leftTime;
    });
  const completedReceives = receiveTransactions.filter(
    (transaction) => transaction.status === "completed",
  );
  const pendingReceives = receiveTransactions.filter(
    (transaction) => transaction.status !== "completed",
  );
  const totalReceivedUnits = sumTransactionUnits(completedReceives, config.exponent);
  const pendingReceivedUnits = sumTransactionUnits(pendingReceives, config.exponent);
  const quotedUnits = parseDecimalToUnits(payload.quotedAmount, config.exponent);
  const deltaUnits =
    totalReceivedUnits > quotedUnits
      ? totalReceivedUnits - quotedUnits
      : quotedUnits - totalReceivedUnits;
  const now = Date.now();
  const expiresAt = Date.parse(payload.quoteExpiresAt);
  const latestCompletedReceive = completedReceives[0] ?? null;
  const latestReceive = receiveTransactions[0] ?? null;
  const latestCompletedTime = Date.parse(latestCompletedReceive?.createdAt ?? "0");
  const totalReceivedAmount = formatUnits(totalReceivedUnits, config.exponent);
  const pendingReceivedAmount = formatUnits(pendingReceivedUnits, config.exponent);
  const summary = makePaymentSummary({
    latestCompletedReceive,
    latestReceive,
    payload,
    pendingReceivedAmount,
    pendingTransactionCount: pendingReceives.length,
    totalReceivedAmount,
    transactionCount: completedReceives.length,
  });

  if (totalReceivedUnits === BigInt(0)) {
    return {
      latestCompletedReceive,
      latestReceive,
      payment: summary,
      status: now > expiresAt ? "expired" : "awaiting_payment",
      totalReceivedAmount,
    };
  }

  if (totalReceivedUnits > quotedUnits + BigInt(1)) {
    return {
      latestCompletedReceive,
      latestReceive,
      payment: summary,
      status: "amount_mismatch",
      totalReceivedAmount,
    };
  }

  if (deltaUnits <= BigInt(1)) {
    return {
      latestCompletedReceive,
      latestReceive,
      payment: summary,
      status: latestCompletedTime > expiresAt ? "late_payment" : "paid",
      totalReceivedAmount,
    };
  }

  return {
    latestCompletedReceive,
    latestReceive,
    payment: summary,
    status: now > expiresAt ? "expired" : "partial",
    totalReceivedAmount,
  };
}

function makeTimeline(
  payload: PushChargeTokenPayload,
  paymentStatus: PushChargeStatus,
  payment: PushChargePaymentSummary,
): PushChargeTimelineEntry[] {
  const timeline: PushChargeTimelineEntry[] = [
    {
      detail: `${payload.quotedAmount} ${payload.asset} requested for ${payload.amountUsd} USD-equivalent on ${payload.network}.`,
      id: `${payload.chargeId}-created`,
      occurredAt: payload.createdAt,
      title: "Quote created",
    },
  ];

  if (payment.pendingTransactionCount > 0 && payment.transactionCount === 0) {
    timeline.push({
      detail: `${payment.pendingReceivedAmount} ${payload.asset} has been detected and is still waiting to complete on-chain.`,
      id: `${payload.chargeId}-pending`,
      occurredAt: payment.latestTransactionAt,
      title: "Inbound payment detected",
    });
  }

  if (payment.transactionCount === 0) {
    timeline.push({
      detail:
        paymentStatus === "expired"
          ? "The quote expired before an exact completed inbound payment arrived."
          : "Waiting for the first completed inbound transfer to this address.",
      id: `${payload.chargeId}-waiting`,
      occurredAt: payment.expiresAt,
      title: paymentStatus === "expired" ? "Quote expired" : "Awaiting payment",
    });

    return timeline;
  }

  if (paymentStatus === "partial") {
    timeline.push({
      detail: `${payment.totalReceivedAmount} ${payload.asset} has arrived so far. The quote still needs an exact amount match before expiry.`,
      id: `${payload.chargeId}-partial`,
      occurredAt: payment.latestTransactionAt,
      title: "Partial payment received",
    });
    return timeline;
  }

  if (paymentStatus === "amount_mismatch") {
    timeline.push({
      detail: `Received ${payment.totalReceivedAmount} ${payload.asset}, which is outside the exact-match tolerance for ${payload.quotedAmount} ${payload.asset}.`,
      id: `${payload.chargeId}-mismatch`,
      occurredAt: payment.latestTransactionAt,
      title: "Amount mismatch",
    });
    return timeline;
  }

  if (paymentStatus === "late_payment") {
    timeline.push({
      detail: "An exact payment completed after the quote expired, so this charge is marked as late.",
      id: `${payload.chargeId}-late`,
      occurredAt: payment.latestTransactionAt,
      title: "Late payment received",
    });
    return timeline;
  }

  timeline.push({
    detail: `Exact payment detected at ${payment.totalReceivedAmount} ${payload.asset}.`,
    id: `${payload.chargeId}-paid`,
    occurredAt: payment.latestTransactionAt,
    title: "Payment matched",
  });

  return timeline;
}

function buildChargeView(input: {
  payment: PushChargePaymentSummary;
  payload: PushChargeTokenPayload;
  status: PushChargeStatus;
}): PushChargeView {
  return {
    accountId: input.payload.accountId,
    address: input.payload.address,
    addressId: input.payload.addressId,
    amountUsd: input.payload.amountUsd,
    asset: input.payload.asset,
    createdAt: input.payload.createdAt,
    environment: input.payload.environment,
    metadata: input.payload.metadata,
    network: input.payload.network,
    note: input.payload.note,
    payment: input.payment,
    quoteExpiresAt: input.payload.quoteExpiresAt,
    quoteRateUsd: input.payload.quoteRateUsd,
    quotedAmount: input.payload.quotedAmount,
    reference: input.payload.reference,
    status: input.status,
    timeline: makeTimeline(input.payload, input.status, input.payment),
  };
}

export async function createPushCharge(input: CreatePushChargeInput) {
  if (input.environment !== "live") {
    throw new Error("Direct transfers are only available in live mode.");
  }

  const config = getPushAssetConfig(input.asset);
  const network = resolvePushNetwork(input.asset, input.network);
  const accounts = await listWalletAccounts();
  const account = accounts.find(
    (candidate) =>
      candidate.type === "wallet" &&
      candidate.allowDeposits &&
      candidate.currency.code.toUpperCase() === input.asset,
  );

  if (!account) {
    throw new Error(
      `No deposit-enabled ${input.asset} wallet account is currently available.`,
    );
  }

  const exchangeRates = await getExchangeRates(input.asset);
  const usdRate = exchangeRates.rates.USD;

  if (!usdRate) {
    throw new Error(`Coinbase did not return a USD exchange rate for ${input.asset}.`);
  }

  const quotedAmount = roundQuoteAmountUp(
    input.amountUsd,
    usdRate,
    config.exponent,
  );
  const createdAt = new Date().toISOString();
  const quoteExpiresAt = new Date(
    Date.now() + PUSH_QUOTE_TTL_MINUTES * 60 * 1000,
  ).toISOString();
  const chargeId = crypto.randomUUID();
  const address = await createOnchainAddress({
    accountId: account.id,
    name: `Coinbiz ${input.reference}`,
    network,
  });
  const payload: PushChargeTokenPayload = {
    accountId: account.id,
    address: address.address,
    addressId: address.id,
    amountUsd: input.amountUsd,
    asset: input.asset,
    chargeId,
    createdAt,
    environment: input.environment,
    metadata: input.metadata,
    network,
    note: input.note,
    quoteExpiresAt,
    quoteRateUsd: usdRate,
    quotedAmount,
    reference: input.reference,
  };

  return {
    charge: buildChargeView({
      payment: {
        expiresAt: quoteExpiresAt,
        matchedAmount: quotedAmount,
        pendingReceivedAmount: "0",
        pendingTransactionCount: 0,
        totalReceivedAmount: "0",
        transactionCount: 0,
      },
      payload,
      status: "awaiting_payment",
    }),
    payload,
  };
}

export async function syncPushCharge(
  payload: PushChargeTokenPayload,
): Promise<PushChargeView> {
  const transactions = await listAddressTransactions({
    accountId: payload.accountId,
    addressId: payload.addressId,
  });
  const paymentEvaluation = evaluatePaymentStatus(payload, transactions);

  return buildChargeView({
    payment: paymentEvaluation.payment,
    payload,
    status: paymentEvaluation.status,
  });
}
