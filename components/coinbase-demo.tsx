"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { startTransition, useEffect, useState } from "react";
import {
  createPublicClient,
  erc20Abi,
  formatEther,
  formatUnits,
  http,
  type Hex,
} from "viem";
import { base } from "viem/chains";

import {
  buildStoredReceiptContext,
  getReceiptCookieName,
  serializeReceiptContext,
} from "@/app/lib/receipt-context";
import {
  EMBEDDED_WALLET_STATE_EVENT,
  type EmbeddedWalletSessionState,
} from "@/app/lib/cdp/embedded-wallet-state";
import type {
  AgentCheckoutPaymentAttempt,
  SerializableAuthorizationRequest,
} from "@/app/lib/agentic-payment-types";
import type {
  CheckoutEnvironment,
  CoinbaseCheckout,
  DemoStatePayload,
  PushAsset,
  PushChargeView,
  PushNetwork,
} from "@/app/lib/coinbase-types";
import type { EmbeddedWalletPanelConfig } from "@/components/cdp-embedded-wallet-panel";

const EmbeddedWalletPanel = dynamic(
  () =>
    import("@/components/cdp-embedded-wallet-panel").then(
      (module) => module.EmbeddedWalletPanel,
    ),
  {
    loading: () => (
      <div className="space-y-4">
        <div className="h-5 w-32 animate-pulse rounded-full bg-white/60" />
        <div className="h-14 animate-pulse rounded-[1.5rem] bg-white/60" />
        <div className="h-14 animate-pulse rounded-[1.5rem] bg-white/60" />
      </div>
    ),
    ssr: false,
  },
);

type CoinbaseDemoProps = {
  embeddedWalletConfig: EmbeddedWalletPanelConfig;
  initialState: DemoStatePayload;
};

type DemoFlow = "hosted" | "embedded" | "headless" | "push";
type EmbeddedFundingAsset = "USDC" | "ETH";
type WizardStep = "intro" | "environment" | "flow" | "experience";

type CreateCheckoutResponse = {
  checkout: CoinbaseCheckout;
  demoState: DemoStatePayload;
};

type CreateCheckoutErrorResponse = {
  error?: string;
};

type CreatePushChargeResponse = {
  charge: PushChargeView;
  token: string;
};

type SyncPushChargeResponse = {
  charge: PushChargeView;
};

type AgenticPaymentResponse = {
  attempt?: AgentCheckoutPaymentAttempt | null;
  error?: string;
};

type PushChargeErrorResponse = {
  error?: string;
};

type CartItem = {
  caption: string;
  id: string;
  title: string;
  unitAmount: number;
};

type MetadataField = {
  id: string;
  key: string;
  value: string;
};

type EmbeddedWalletBalances = {
  error: string | null;
  eth: string | null;
  refreshedAt: string | null;
  status: "idle" | "loading" | "success" | "error";
  usdc: string | null;
};

type EmbeddedSwapQuoteState = {
  error: string | null;
  expectedUsdc: string | null;
  expectedUsdcAtomic: string | null;
  fromAmountAtomic: string | null;
  fromAmountEth: string | null;
  minUsdc: string | null;
  minUsdcAtomic: string | null;
  networkFeeEth: string | null;
  status: "idle" | "loading" | "success" | "error";
};

type EmbeddedSwapPlan = {
  expectedUsdc: string;
  expectedUsdcAtomic: string;
  fromAmountAtomic: string;
  fromAmountEth: string;
  minUsdc: string;
  minUsdcAtomic: string;
  networkFeeEth: string | null;
};

type EmbeddedSwapReceipt = {
  expectedUsdc: string;
  fromAmountEth: string;
  minUsdc: string;
  status: "submitted" | "confirmed";
  transactionHash: string | null;
};

const PUSH_QR_SIZE = 280;
const BITCOIN_NETWORK: PushNetwork = "bitcoin";
const BASE_RPC_URL = "https://mainnet.base.org";
const BASE_USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const EVM_NATIVE_TOKEN_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ETHEREUM_MAINNET_CHAIN_ID = 1;
const BASE_MAINNET_CHAIN_ID = 8453;
const ETHEREUM_NATIVE_DECIMALS = 18;
const USDC_DECIMALS = 6;
const EMBEDDED_SWAP_SLIPPAGE_BPS = 100;
const EMBEDDED_ETH_SWAP_SEED_WEI = BigInt("1000000000000");
const EMBEDDED_ETH_SWAP_SAFETY_BPS = BigInt(250);
const EMBEDDED_ETH_SWAP_MAX_QUOTE_ATTEMPTS = 4;
const TEST_CART: CartItem = {
  caption: "",
  id: "test-payment",
  title: "Payment",
  unitAmount: 0.01,
};

const basePublicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC_URL),
});

const environmentLabels: Record<CheckoutEnvironment, string> = {
  live: "Live",
  sandbox: "Sandbox",
};

const flowLabels: Record<DemoFlow, string> = {
  embedded: "Embedded Flow",
  headless: "Headless",
  hosted: "Hosted Flow",
  push: "Push",
};

const pushAssetOptions: PushAsset[] = ["BTC", "ETH"];

const ethNetworkOptions: Array<{
  label: string;
  network: PushNetwork;
}> = [
  {
    label: "Ethereum",
    network: "ethereum",
  },
  {
    label: "Base",
    network: "base",
  },
];

const hostedTerminalStatuses = new Set([
  "CANCELED",
  "COMPLETED",
  "EXPIRED",
  "FAILED",
  "REFUNDED",
]);

const initialMetadataFields: MetadataField[] = [
  {
    id: "metadata-1",
    key: "",
    value: "",
  },
];

const statusStyles: Record<string, string> = {
  ACTIVE: "bg-[#e5edff] text-[#3155c4]",
  AMOUNT_MISMATCH: "bg-[#ffe9e7] text-[#a44038]",
  AWAITING_PAYMENT: "bg-[#e9f0ff] text-[#345ecc]",
  COMPLETED: "bg-[#e8f7f3] text-[#1b7f63]",
  CONVERSION_FAILED: "bg-[#ffe9e7] text-[#a44038]",
  CONVERSION_FILLED: "bg-[#e8f7f3] text-[#1b7f63]",
  CONVERSION_SUBMITTED: "bg-[#e9f0ff] text-[#345ecc]",
  DEACTIVATED: "bg-[#edf1f7] text-[#55627a]",
  EXPIRED: "bg-[#fff1dd] text-[#99631a]",
  FAILED: "bg-[#ffe9e7] text-[#a44038]",
  LATE_PAYMENT: "bg-[#fff1dd] text-[#99631a]",
  PAID: "bg-[#e8f7f3] text-[#1b7f63]",
  PARTIAL: "bg-[#fff1dd] text-[#99631a]",
  PROCESSING: "bg-[#e9f0ff] text-[#345ecc]",
  UNSUPPORTED: "bg-[#edf1f7] text-[#55627a]",
};

function formatAmount(value: number | string, currencyLabel = "USDC") {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return `${parsed.toFixed(2)} ${currencyLabel}`;
}

function formatStatusLabel(status: string) {
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatTimestamp(value?: string | null) {
  if (!value) {
    return "Pending";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function getStatusStyle(status: string) {
  return statusStyles[status.toUpperCase()] ?? "bg-[#efefea] text-[#4a4a45]";
}

function formatAttemptStage(stage: AgentCheckoutPaymentAttempt["stage"]) {
  return formatStatusLabel(stage);
}

function getAttemptStageStyle(stage: AgentCheckoutPaymentAttempt["stage"]) {
  switch (stage) {
    case "completed":
      return "bg-[#e8f7f3] text-[#1b7f63]";
    case "failed":
      return "bg-[#ffe9e7] text-[#a44038]";
    case "submitted":
      return "bg-[#e9f0ff] text-[#345ecc]";
    case "signed":
      return "bg-[#efe8ff] text-[#5a3faa]";
    case "payload_resolved":
      return "bg-[#fff1dd] text-[#99631a]";
    default:
      return "bg-[#efefea] text-[#4a4a45]";
  }
}

function isAttemptTerminal(stage?: AgentCheckoutPaymentAttempt["stage"]) {
  return stage === "completed" || stage === "failed";
}

function isTerminalPushStatus(status?: string) {
  return (
    status === "amount_mismatch" ||
    status === "expired" ||
    status === "late_payment" ||
    status === "paid" ||
    status === "unsupported"
  );
}

function decimalToAtomicUnits(value: string, decimals: number) {
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

function formatCompactCryptoAmount(value: string | null, symbol: string) {
  if (!value) {
    return `- ${symbol}`;
  }

  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed)) {
    return `- ${symbol}`;
  }

  const precision = symbol === "USDC" ? 4 : 6;

  return `${parsed.toLocaleString(undefined, {
    maximumFractionDigits: precision,
    minimumFractionDigits: 0,
  })} ${symbol}`;
}

function formatAtomicTokenAmount(value: string, decimals: number) {
  return formatUnits(BigInt(value), decimals);
}

function createIdleEmbeddedSwapQuote(): EmbeddedSwapQuoteState {
  return {
    error: null,
    expectedUsdc: null,
    expectedUsdcAtomic: null,
    fromAmountAtomic: null,
    fromAmountEth: null,
    minUsdc: null,
    minUsdcAtomic: null,
    networkFeeEth: null,
    status: "idle",
  };
}

function createEmbeddedSwapQuoteError(error: string): EmbeddedSwapQuoteState {
  return {
    ...createIdleEmbeddedSwapQuote(),
    error,
    status: "error",
  };
}

function toEmbeddedSwapQuoteState(plan: EmbeddedSwapPlan): EmbeddedSwapQuoteState {
  return {
    error: null,
    expectedUsdc: plan.expectedUsdc,
    expectedUsdcAtomic: plan.expectedUsdcAtomic,
    fromAmountAtomic: plan.fromAmountAtomic,
    fromAmountEth: plan.fromAmountEth,
    minUsdc: plan.minUsdc,
    minUsdcAtomic: plan.minUsdcAtomic,
    networkFeeEth: plan.networkFeeEth,
    status: "success",
  };
}

function formatNetworkFeeEth(value: string | null) {
  return value ? formatCompactCryptoAmount(value, "ETH") : "Included in quote";
}

function hasEnoughQuotedUsdc(
  quote: EmbeddedSwapQuoteState,
  targetUsdcAtomic: string,
) {
  if (quote.status !== "success" || !quote.minUsdcAtomic) {
    return false;
  }

  return BigInt(quote.minUsdcAtomic) >= BigInt(targetUsdcAtomic);
}

async function fetchEmbeddedWalletBalances(address: `0x${string}`) {
  const [ethBalance, usdcBalance] = await Promise.all([
    basePublicClient.getBalance({ address }),
    basePublicClient.readContract({
      abi: erc20Abi,
      address: BASE_USDC_ADDRESS,
      args: [address],
      functionName: "balanceOf",
    }),
  ]);

  return {
    eth: formatEther(ethBalance),
    usdc: formatUnits(usdcBalance, USDC_DECIMALS),
  };
}

async function fetchEmbeddedEthSwapQuote(input: {
  account: `0x${string}`;
  fromAmountAtomic: bigint;
}) {
  const { getSwapPrice } = await import("@coinbase/cdp-core");
  const quote = await getSwapPrice({
    account: input.account,
    fromAmount: input.fromAmountAtomic.toString(),
    fromToken: EVM_NATIVE_TOKEN_ADDRESS,
    network: "base",
    slippageBps: EMBEDDED_SWAP_SLIPPAGE_BPS,
    toToken: BASE_USDC_ADDRESS,
  });

  if (!quote.liquidityAvailable) {
    throw new Error("No Base ETH -> USDC swap route is available right now.");
  }

  if (quote.issues?.balance) {
    throw new Error("The embedded wallet does not have enough Base ETH for this swap.");
  }

  if (quote.issues?.allowance) {
    throw new Error("Unexpected allowance issue for native ETH swap.");
  }

  return quote;
}

function scaleEthInputForTarget(input: {
  currentFromAmountAtomic: bigint;
  quotedMinUsdcAtomic: string;
  targetUsdcAtomic: string;
}) {
  const quotedMinUsdcAtomic = BigInt(input.quotedMinUsdcAtomic);
  const targetUsdcAtomic = BigInt(input.targetUsdcAtomic);

  if (quotedMinUsdcAtomic <= BigInt(0)) {
    return input.currentFromAmountAtomic * BigInt(2);
  }

  const baseBps = BigInt(10000);
  const multiplier = baseBps + EMBEDDED_ETH_SWAP_SAFETY_BPS;

  return (
    (input.currentFromAmountAtomic * targetUsdcAtomic * multiplier +
      quotedMinUsdcAtomic * baseBps -
      BigInt(1)) /
    (quotedMinUsdcAtomic * baseBps)
  );
}

function buildEmbeddedSwapPlan(input: {
  fromAmountAtomic: bigint;
  quote: Awaited<ReturnType<typeof fetchEmbeddedEthSwapQuote>>;
}): EmbeddedSwapPlan {
  return {
    expectedUsdc: formatAtomicTokenAmount(input.quote.toAmount, USDC_DECIMALS),
    expectedUsdcAtomic: input.quote.toAmount,
    fromAmountAtomic: input.fromAmountAtomic.toString(),
    fromAmountEth: formatEther(input.fromAmountAtomic),
    minUsdc: formatAtomicTokenAmount(input.quote.minToAmount, USDC_DECIMALS),
    minUsdcAtomic: input.quote.minToAmount,
    networkFeeEth: input.quote.totalNetworkFee
      ? formatEther(BigInt(input.quote.totalNetworkFee))
      : null,
  };
}

async function createEmbeddedEthSwapPlan(input: {
  account: `0x${string}`;
  targetUsdcAtomic: string;
}) {
  let fromAmountAtomic = EMBEDDED_ETH_SWAP_SEED_WEI;

  for (
    let attempt = 0;
    attempt < EMBEDDED_ETH_SWAP_MAX_QUOTE_ATTEMPTS;
    attempt += 1
  ) {
    const quote = await fetchEmbeddedEthSwapQuote({
      account: input.account,
      fromAmountAtomic,
    });
    const plan = buildEmbeddedSwapPlan({
      fromAmountAtomic,
      quote,
    });

    if (BigInt(plan.minUsdcAtomic) >= BigInt(input.targetUsdcAtomic)) {
      return plan;
    }

    fromAmountAtomic = scaleEthInputForTarget({
      currentFromAmountAtomic: fromAmountAtomic,
      quotedMinUsdcAtomic: plan.minUsdcAtomic,
      targetUsdcAtomic: input.targetUsdcAtomic,
    });
  }

  throw new Error("Unable to calculate enough Base ETH to cover the $0.01 checkout.");
}

function buildPushPaymentUri(pushCharge: PushChargeView) {
  if (pushCharge.asset === "BTC") {
    const searchParams = new URLSearchParams({
      amount: pushCharge.quotedAmount,
    });

    return `bitcoin:${pushCharge.address}?${searchParams.toString()}`;
  }

  if (pushCharge.asset === "ETH") {
    const value = decimalToAtomicUnits(
      pushCharge.quotedAmount,
      ETHEREUM_NATIVE_DECIMALS,
    );
    const chainId =
      pushCharge.network === "base"
        ? BASE_MAINNET_CHAIN_ID
        : ETHEREUM_MAINNET_CHAIN_ID;

    return `ethereum:${pushCharge.address}@${chainId}?value=${value}`;
  }

  return pushCharge.address;
}

function getPushQrImageUrl(value: string) {
  const searchParams = new URLSearchParams({
    data: value,
    size: `${PUSH_QR_SIZE}x${PUSH_QR_SIZE}`,
  });

  return `https://api.qrserver.com/v1/create-qr-code/?${searchParams.toString()}`;
}

function persistReceiptContext(
  environment: CheckoutEnvironment,
  checkout: CoinbaseCheckout,
) {
  const secureFlag = window.location.protocol === "https:" ? "; Secure" : "";
  const cookieName = getReceiptCookieName(environment);
  const cookieValue = serializeReceiptContext(
    buildStoredReceiptContext(checkout, environment),
  );

  document.cookie = `${cookieName}=${cookieValue}; Max-Age=14400; Path=/; SameSite=Lax${secureFlag}`;
}

async function fetchDemoStateFromServer() {
  const response = await fetch("/api/coinbase/state", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Unable to refresh checkout status.");
  }

  return (await response.json()) as DemoStatePayload;
}

async function fetchPushChargeFromServer(token: string) {
  const response = await fetch("/api/coinbase/push-charges/sync", {
    body: JSON.stringify({ token }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const data = (await response.json()) as
    | SyncPushChargeResponse
    | PushChargeErrorResponse;

  if (!response.ok || !("charge" in data)) {
    const message =
      "error" in data ? data.error : "Unable to refresh the push payment.";
    throw new Error(message ?? "Unable to refresh the push payment.");
  }

  return data.charge;
}

function buildCheckoutMetadata(
  flow: DemoFlow,
  customMetadata: Record<string, string>,
  automaticMetadata: Record<string, string> = {},
) {
  return {
    amount: TEST_CART.unitAmount.toFixed(2),
    cart: TEST_CART.id,
    flow,
    ...automaticMetadata,
    reference: customMetadata.reference ?? `coinbiz-${Date.now()}`,
    ...customMetadata,
  };
}

function createMetadataField(): MetadataField {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `metadata-${Date.now()}`,
    key: "",
    value: "",
  };
}

function buildCustomMetadata(fields: MetadataField[]) {
  const metadata: Record<string, string> = {};

  for (const field of fields) {
    const key = field.key.trim();
    const value = field.value.trim();

    if (!key && !value) {
      continue;
    }

    if (!key && value) {
      throw new Error("Add a field name or clear the metadata value.");
    }

    if (key && value) {
      metadata[key] = value;
    }
  }

  return metadata;
}

function isSerializableAuthorizationRequest(
  value: unknown,
): value is SerializableAuthorizationRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const paymentInfo = value as Partial<SerializableAuthorizationRequest>;

  return (
    typeof paymentInfo.domain?.chainId === "number" &&
    typeof paymentInfo.domain?.name === "string" &&
    typeof paymentInfo.domain?.verifyingContract === "string" &&
    typeof paymentInfo.domain?.version === "string" &&
    typeof paymentInfo.message?.from === "string" &&
    typeof paymentInfo.message?.nonce === "string" &&
    typeof paymentInfo.message?.to === "string" &&
    typeof paymentInfo.message?.validAfter === "string" &&
    typeof paymentInfo.message?.validBefore === "string" &&
    typeof paymentInfo.message?.value === "string" &&
    typeof paymentInfo.primaryType === "string" &&
    Boolean(paymentInfo.types?.ReceiveWithAuthorization)
  );
}

function toEmbeddedWalletTypedData(
  paymentInfo: SerializableAuthorizationRequest,
  payerAddress: string,
) {
  return {
    domain: {
      ...paymentInfo.domain,
      verifyingContract: paymentInfo.domain.verifyingContract as `0x${string}`,
    },
    message: {
      ...paymentInfo.message,
      from: payerAddress,
      validAfter: Number(paymentInfo.message.validAfter),
      validBefore: Number(paymentInfo.message.validBefore),
    },
    primaryType: paymentInfo.primaryType,
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ReceiveWithAuthorization: paymentInfo.types.ReceiveWithAuthorization,
    },
  };
}

function StepHeader({
  onBack,
  stepLabel,
  title,
}: {
  onBack: () => void;
  stepLabel: string;
  title: string;
}) {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4">
      <div className="space-y-2">
        <p className="eyebrow">{stepLabel}</p>
        <h1 className="display-font text-4xl font-semibold tracking-[-0.05em] text-[var(--foreground)] sm:text-5xl">
          {title}
        </h1>
      </div>

      <button
        className="rounded-full border border-[var(--line)] bg-white/70 px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--accent-strong)] hover:shadow-[0_14px_38px_rgba(54,103,255,0.18)]"
        onClick={onBack}
        type="button"
      >
        Back
      </button>
    </header>
  );
}

function ReceiptField({
  href,
  label,
  mono = false,
  value,
}: {
  href?: string;
  label: string;
  mono?: boolean;
  value: string;
}) {
  const content = href ? (
    <a
      className="break-all text-[var(--accent-strong)] underline-offset-4 hover:underline"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {value}
    </a>
  ) : (
    value
  );

  return (
    <div className="grid gap-1 border-b border-[var(--line)] py-3 last:border-b-0 sm:grid-cols-[120px_1fr] sm:gap-3">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-soft)]">
        {label}
      </p>
      <p
        className={`text-sm text-[var(--foreground)] ${mono ? "break-all font-mono" : ""}`}
      >
        {content}
      </p>
    </div>
  );
}

function MetadataPreview({
  metadata,
}: {
  metadata: Record<string, string> | null;
}) {
  if (!metadata || Object.keys(metadata).length === 0) {
    return null;
  }

  return (
    <div className="rounded-[1.5rem] border border-[var(--line)] bg-[#f7f9ff] px-4 py-4">
      <p className="eyebrow">Metadata</p>
      <div className="mt-3 space-y-2">
        {Object.entries(metadata).map(([key, value]) => (
          <div
            key={key}
            className="grid gap-1 text-sm sm:grid-cols-[120px_1fr] sm:gap-3"
          >
            <p className="font-semibold text-[var(--foreground)]">{key}</p>
            <p className="break-all text-[var(--ink-soft)]">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function isCoinbaseCheckout(value: unknown): value is CoinbaseCheckout {
  if (!value || typeof value !== "object") {
    return false;
  }

  const checkout = value as Partial<CoinbaseCheckout>;

  return (
    typeof checkout.id === "string" &&
    typeof checkout.amount === "string" &&
    typeof checkout.currency === "string" &&
    typeof checkout.status === "string" &&
    typeof checkout.network === "string"
  );
}

function getAttemptCheckout(attempt: AgentCheckoutPaymentAttempt | null) {
  if (!attempt) {
    return null;
  }

  return isCoinbaseCheckout(attempt.rawCheckoutStatus)
    ? attempt.rawCheckoutStatus
    : null;
}

function getReceiptMetadata(
  fallbackMetadata: Record<string, string> | null,
  checkout?: CoinbaseCheckout | null,
) {
  return checkout?.metadata && Object.keys(checkout.metadata).length > 0
    ? checkout.metadata
    : fallbackMetadata;
}

function getReference(metadata: Record<string, string> | null) {
  return metadata?.reference ?? "Pending";
}

function getNetworkExplorerUrl(network: string, hash: string) {
  return network.toLowerCase() === "base"
    ? `https://basescan.org/tx/${hash}`
    : network.toLowerCase() === "ethereum"
      ? `https://etherscan.io/tx/${hash}`
    : undefined;
}

function getPushTransactionUrl(pushCharge: PushChargeView) {
  const hash = pushCharge.payment.latestTransactionHash;

  if (!hash) {
    return undefined;
  }

  if (pushCharge.asset === "BTC") {
    return `https://mempool.space/tx/${hash}`;
  }

  return getNetworkExplorerUrl(pushCharge.network, hash);
}

function MetadataFieldsEditor({
  fields,
  onAdd,
  onRemove,
  onUpdate,
}: {
  fields: MetadataField[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, field: "key" | "value", value: string) => void;
}) {
  return (
    <div className="mt-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--foreground)]">
            Optional metadata
          </p>
          <p className="mt-1 text-xs leading-6 text-[var(--ink-soft)]">
            Add normal fields. Empty rows are ignored.
          </p>
        </div>
        <button
          className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--accent-strong)] hover:shadow-[0_10px_30px_rgba(54,103,255,0.14)]"
          onClick={onAdd}
          type="button"
        >
          Add field
        </button>
      </div>

      <div className="space-y-3">
        {fields.map((field, index) => (
          <div
            key={field.id}
            className="grid gap-3 rounded-[1.5rem] border border-[var(--line)] bg-[#f7f9ff] p-3 md:grid-cols-[0.9fr_1.1fr_auto]"
          >
            <label className="block space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                Field
              </span>
              <input
                className="w-full rounded-[1rem] border border-[var(--line)] bg-white px-3 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)]"
                onChange={(event) =>
                  onUpdate(field.id, "key", event.target.value)
                }
                placeholder={index === 0 ? "customerId" : "campaign"}
                value={field.key}
              />
            </label>
            <label className="block space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                Value
              </span>
              <input
                className="w-full rounded-[1rem] border border-[var(--line)] bg-white px-3 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)]"
                onChange={(event) =>
                  onUpdate(field.id, "value", event.target.value)
                }
                placeholder={index === 0 ? "123" : "spring"}
                value={field.value}
              />
            </label>
            <button
              className="self-end rounded-full border border-[var(--line)] bg-white px-4 py-3 text-sm font-semibold text-[var(--ink-soft)] transition hover:border-[#efc8c3] hover:text-[#8f352d] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={fields.length === 1}
              onClick={() => onRemove(field.id)}
              type="button"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmbeddedFundingControls({
  balances,
  fundingAsset,
  isReady,
  onFundingAssetChange,
  onRefreshBalances,
  paymentAmountAtomicUsdc,
  paymentPhase,
  quote,
  swapReceipt,
}: {
  balances: EmbeddedWalletBalances;
  fundingAsset: EmbeddedFundingAsset;
  isReady: boolean;
  onFundingAssetChange: (asset: EmbeddedFundingAsset) => void;
  onRefreshBalances: () => void;
  paymentAmountAtomicUsdc: string;
  paymentPhase: string | null;
  quote: EmbeddedSwapQuoteState;
  swapReceipt: EmbeddedSwapReceipt | null;
}) {
  const quoteCoversPayment = hasEnoughQuotedUsdc(quote, paymentAmountAtomicUsdc);
  const swapTxUrl = swapReceipt?.transactionHash
    ? getNetworkExplorerUrl("base", swapReceipt.transactionHash)
    : undefined;

  return (
    <div className="mt-6 space-y-4 rounded-[1.5rem] border border-[var(--line)] bg-white px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--foreground)]">
            Embedded wallet funding
          </p>
        </div>
        <button
          className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--accent-strong)] hover:shadow-[0_10px_30px_rgba(54,103,255,0.14)] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!isReady || balances.status === "loading"}
          onClick={onRefreshBalances}
          type="button"
        >
          {balances.status === "loading" ? "Refreshing..." : "Refresh balances"}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-[1.25rem] border border-[var(--line)] bg-[#f7f9ff] px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
            Base ETH
          </p>
          <p className="mt-2 text-lg font-semibold text-[var(--foreground)]">
            {formatCompactCryptoAmount(balances.eth, "ETH")}
          </p>
        </div>
        <div className="rounded-[1.25rem] border border-[var(--line)] bg-[#f7f9ff] px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
            Base USDC
          </p>
          <p className="mt-2 text-lg font-semibold text-[var(--foreground)]">
            {formatCompactCryptoAmount(balances.usdc, "USDC")}
          </p>
        </div>
      </div>

      {balances.error ? (
        <div className="rounded-[1.25rem] border border-[#efc8c3] bg-[#fbefed] px-4 py-3 text-sm text-[#8f352d]">
          {balances.error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {(["USDC", "ETH"] as EmbeddedFundingAsset[]).map((asset) => (
          <button
            key={asset}
            className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
              fundingAsset === asset
                ? "border-[var(--accent-strong)] bg-[var(--accent-strong)] text-white shadow-[0_10px_35px_rgba(54,103,255,0.24)]"
                : "border-[var(--line)] bg-white text-[var(--foreground)] hover:border-[var(--accent-strong)] hover:shadow-[0_10px_30px_rgba(54,103,255,0.14)]"
            }`}
            onClick={() => onFundingAssetChange(asset)}
            type="button"
          >
            {asset === "ETH" ? "ETH on Base" : "USDC on Base"}
          </button>
        ))}
      </div>

      {fundingAsset === "ETH" ? (
        <div className="space-y-3 rounded-[1.25rem] border border-[var(--line)] bg-[#f7f9ff] px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                ETH needed
              </p>
              <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">
                {formatCompactCryptoAmount(quote.fromAmountEth, "ETH")}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                Expected USDC
              </p>
              <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">
                {formatCompactCryptoAmount(quote.expectedUsdc, "USDC")}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                Minimum
              </p>
              <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">
                {formatCompactCryptoAmount(quote.minUsdc, "USDC")}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                Network fee
              </p>
              <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">
                {formatNetworkFeeEth(quote.networkFeeEth)}
              </p>
            </div>
          </div>

          {quote.status === "loading" ? (
            <p className="text-sm text-[var(--ink-soft)]">
              Calculating the ETH amount needed to pay $0.01 USDC...
            </p>
          ) : null}

          {quote.status === "success" && !quoteCoversPayment ? (
            <div className="rounded-[1rem] border border-[#efc8c3] bg-[#fbefed] px-4 py-3 text-sm text-[#8f352d]">
              The automatic quote did not cover the $0.01 checkout. Refresh
              balances and try again.
            </div>
          ) : null}

          {quote.error ? (
            <div className="rounded-[1rem] border border-[#efc8c3] bg-[#fbefed] px-4 py-3 text-sm text-[#8f352d]">
              {quote.error}
            </div>
          ) : null}
        </div>
      ) : null}

      {paymentPhase ? (
        <div className="rounded-[1.25rem] border border-[#c8d7ff] bg-[#eef4ff] px-4 py-3 text-sm font-semibold text-[#345ecc]">
          {paymentPhase}
        </div>
      ) : null}

      {swapReceipt ? (
        <div className="divide-y divide-[var(--line)] rounded-[1.25rem] border border-[var(--line)] bg-[#f7f9ff] px-4 py-2">
          <ReceiptField label="Swap status" value={formatStatusLabel(swapReceipt.status)} />
          <ReceiptField
            label="Swap tx"
            mono
            href={swapTxUrl}
            value={swapReceipt.transactionHash ?? "Pending"}
          />
          <ReceiptField
            label="ETH swapped"
            value={`${swapReceipt.fromAmountEth} ETH`}
          />
          <ReceiptField
            label="Minimum USDC"
            value={`${swapReceipt.minUsdc} USDC`}
          />
        </div>
      ) : null}
    </div>
  );
}

function HeadlessExecutionLog({
  attempt,
  checkout,
}: {
  attempt: AgentCheckoutPaymentAttempt | null;
  checkout: CoinbaseCheckout | null;
}) {
  const completed = attempt?.stage === "completed";
  const failed = attempt?.stage === "failed";
  const entries = [
    {
      detail: checkout?.id ?? attempt?.checkoutId ?? "Waiting for checkout",
      done: Boolean(checkout || attempt),
      label: "Checkout created",
    },
    {
      detail: attempt?.tokenCollector ?? "Waiting for payment payload",
      done: Boolean(attempt?.tokenCollector),
      label: "Payload resolved",
    },
    {
      detail: attempt?.signatureRef ? "Payment-scoped authorization ready" : "Waiting for signer",
      done: Boolean(attempt?.signatureRef),
      label: "Server authorization signed",
    },
    {
      detail: attempt?.submissionRequestId ?? "Waiting for submission",
      done: Boolean(attempt?.submissionRequestId),
      label: "Submitted to Coinbase",
    },
    {
      detail: failed
        ? attempt?.errorMessage ?? "Payment failed"
        : completed
          ? attempt?.txHash ?? "Completed"
          : "Waiting for reconciliation",
      done: completed || failed,
      failed,
      label: failed ? "Failed" : completed ? "Completed" : "Reconciled",
    },
  ];

  return (
    <div className="rounded-[2rem] border border-[var(--line)] bg-white/86 p-6 shadow-[0_18px_50px_rgba(54,103,255,0.12)]">
      <div className="space-y-2">
        <p className="eyebrow">Headless Flow</p>
        <h2 className="display-font text-2xl font-semibold tracking-[-0.03em]">
          What happens
        </h2>
        <p className="text-sm leading-7 text-[var(--ink-soft)]">
          Headless creates a Coinbase checkout, resolves the payment payload,
          signs a payment-scoped USDC authorization on the server, submits it to
          Coinbase, and reconciles settlement.
        </p>
      </div>

      <div className="mt-5 space-y-3">
        {entries.map((entry) => (
          <div
            key={entry.label}
            className="flex items-start gap-3 rounded-[1.25rem] border border-[var(--line)] bg-[#f7f9ff] px-4 py-3"
          >
            <span
              className={`mt-1 h-2.5 w-2.5 rounded-full ${
                entry.failed
                  ? "bg-[#a44038]"
                  : entry.done
                    ? "bg-[#1b7f63]"
                    : "bg-[#aeb8cc]"
              }`}
            />
            <div>
              <p className="text-sm font-semibold text-[var(--foreground)]">
                {entry.label}
              </p>
              <p className="mt-1 break-all text-xs leading-5 text-[var(--ink-soft)]">
                {entry.detail}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function getSelectionTileClassName(active = false) {
  return [
    "group relative overflow-hidden rounded-[2rem] border px-7 py-7 text-left text-white transition duration-200",
    "border-[#9bb6ff]/65 bg-[linear-gradient(160deg,#5f86ff_0%,#3d6eff_52%,#1e4fe4_100%)]",
    "shadow-[0_18px_50px_rgba(54,103,255,0.24)] hover:-translate-y-1 hover:shadow-[0_28px_82px_rgba(54,103,255,0.4)]",
    active ? "ring-2 ring-[#d7e4ff] ring-offset-4 ring-offset-transparent" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function getDisabledTileClassName() {
  return [
    "relative overflow-hidden rounded-[2rem] border px-7 py-7 text-left text-white/90 transition",
    "cursor-not-allowed border-[#9bb6ff]/40 bg-[linear-gradient(160deg,#7e9cf3_0%,#6482dc_52%,#4d65b4_100%)] opacity-55",
    "shadow-[0_14px_36px_rgba(54,103,255,0.16)]",
  ].join(" ");
}

export function CoinbaseDemo({
  embeddedWalletConfig,
  initialState,
}: CoinbaseDemoProps) {
  const [wizardStep, setWizardStep] = useState<WizardStep>("intro");
  const [selectedFlow, setSelectedFlow] = useState<DemoFlow | null>(null);
  const [environment, setEnvironment] = useState<CheckoutEnvironment>("sandbox");
  const [metadataFields, setMetadataFields] = useState<MetadataField[]>(
    initialMetadataFields,
  );
  const [submittedMetadata, setSubmittedMetadata] =
    useState<Record<string, string> | null>(null);
  const [checkoutCreating, setCheckoutCreating] = useState(false);
  const [checkoutErrorMessage, setCheckoutErrorMessage] = useState<string | null>(
    null,
  );
  const [pushAsset, setPushAsset] = useState<PushAsset>("BTC");
  const [pushNetwork, setPushNetwork] = useState<PushNetwork>(BITCOIN_NETWORK);
  const [pushCharge, setPushCharge] = useState<PushChargeView | null>(null);
  const [pushCreating, setPushCreating] = useState(false);
  const [pushErrorMessage, setPushErrorMessage] = useState<string | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [embeddedWalletSession, setEmbeddedWalletSession] =
    useState<EmbeddedWalletSessionState>({
      email: null,
      evmAddress: null,
      isInitialized: false,
      isSignedIn: false,
      userId: null,
    });
  const [embeddedWalletAttempt, setEmbeddedWalletAttempt] =
    useState<AgentCheckoutPaymentAttempt | null>(null);
  const [embeddedFundingAsset, setEmbeddedFundingAsset] =
    useState<EmbeddedFundingAsset>("USDC");
  const [embeddedPaymentPhase, setEmbeddedPaymentPhase] = useState<string | null>(
    null,
  );
  const [embeddedSwapQuote, setEmbeddedSwapQuote] =
    useState<EmbeddedSwapQuoteState>({
      error: null,
      expectedUsdc: null,
      expectedUsdcAtomic: null,
      fromAmountAtomic: null,
      fromAmountEth: null,
      minUsdc: null,
      minUsdcAtomic: null,
      networkFeeEth: null,
      status: "idle",
    });
  const [embeddedSwapReceipt, setEmbeddedSwapReceipt] =
    useState<EmbeddedSwapReceipt | null>(null);
  const [embeddedWalletBalances, setEmbeddedWalletBalances] =
    useState<EmbeddedWalletBalances>({
      error: null,
      eth: null,
      refreshedAt: null,
      status: "idle",
      usdc: null,
    });
  const [trackedEmbeddedWalletCheckoutId, setTrackedEmbeddedWalletCheckoutId] =
    useState<string | null>(null);
  const [headlessAttempt, setHeadlessAttempt] =
    useState<AgentCheckoutPaymentAttempt | null>(null);
  const [headlessCreating, setHeadlessCreating] = useState(false);
  const [trackedHostedCheckoutId, setTrackedHostedCheckoutId] =
    useState<string | null>(null);
  const [trackedHeadlessCheckoutId, setTrackedHeadlessCheckoutId] =
    useState<string | null>(null);
  const [demoState, setDemoState] = useState(initialState);

  const totalAmount = TEST_CART.unitAmount;
  const totalAmountAtomicUsdc = decimalToAtomicUnits(
    totalAmount.toFixed(2),
    USDC_DECIMALS,
  );
  const embeddedWalletReady =
    embeddedWalletSession.isInitialized &&
    embeddedWalletSession.isSignedIn &&
    Boolean(embeddedWalletSession.evmAddress);
  const embeddedEthSwapReady =
    embeddedFundingAsset !== "ETH" ||
    hasEnoughQuotedUsdc(embeddedSwapQuote, totalAmountAtomicUsdc);
  const selectedFlowTitle = selectedFlow ? flowLabels[selectedFlow] : null;
  const liveCheckouts = demoState.checkouts.filter(
    (checkout) => checkout.demoEnvironment === environment,
  );
  const activeCheckout = liveCheckouts[0] ?? null;
  const currentHostedCheckout = trackedHostedCheckoutId
    ? liveCheckouts.find((checkout) => checkout.id === trackedHostedCheckoutId) ??
      activeCheckout
    : activeCheckout;
  const currentEmbeddedWalletAttempt =
    embeddedWalletAttempt &&
    (!trackedEmbeddedWalletCheckoutId ||
      embeddedWalletAttempt.checkoutId === trackedEmbeddedWalletCheckoutId)
      ? embeddedWalletAttempt
      : null;
  const currentHeadlessAttempt =
    headlessAttempt &&
    (!trackedHeadlessCheckoutId ||
      headlessAttempt.checkoutId === trackedHeadlessCheckoutId)
      ? headlessAttempt
      : null;
  const currentErrorMessage =
    selectedFlow === "push" ? pushErrorMessage : checkoutErrorMessage;
  const pushQrValue = pushCharge ? buildPushPaymentUri(pushCharge) : null;

  function resetMessages() {
    setCheckoutErrorMessage(null);
    setPushErrorMessage(null);
  }

  function addMetadataField() {
    setMetadataFields((currentFields) => [
      ...currentFields,
      createMetadataField(),
    ]);
  }

  function removeMetadataField(id: string) {
    setMetadataFields((currentFields) =>
      currentFields.length === 1
        ? currentFields
        : currentFields.filter((field) => field.id !== id),
    );
  }

  function updateMetadataField(
    id: string,
    fieldName: "key" | "value",
    value: string,
  ) {
    setMetadataFields((currentFields) =>
      currentFields.map((field) =>
        field.id === id ? { ...field, [fieldName]: value } : field,
      ),
    );
  }

  function resetSelectionsOnMount() {
    setWizardStep("intro");
    setSelectedFlow(null);
    setEnvironment("sandbox");
  }

  useEffect(() => {
    resetSelectionsOnMount();
  }, []);

  useEffect(() => {
    setEmbeddedWalletSession(
      window.__coinbizEmbeddedWalletState ?? {
        email: null,
        evmAddress: null,
        isInitialized: false,
        isSignedIn: false,
        userId: null,
      },
    );

    const handleEmbeddedWalletState = (event: Event) => {
      const walletEvent = event as CustomEvent<EmbeddedWalletSessionState>;
      setEmbeddedWalletSession(walletEvent.detail);
    };

    window.addEventListener(
      EMBEDDED_WALLET_STATE_EVENT,
      handleEmbeddedWalletState as EventListener,
    );

    return () => {
      window.removeEventListener(
        EMBEDDED_WALLET_STATE_EVENT,
        handleEmbeddedWalletState as EventListener,
      );
    };
  }, []);

  async function refreshEmbeddedWalletBalances() {
    if (!embeddedWalletSession.evmAddress) {
      setEmbeddedWalletBalances({
        error: null,
        eth: null,
        refreshedAt: null,
        status: "idle",
        usdc: null,
      });
      return;
    }

    const address = embeddedWalletSession.evmAddress as `0x${string}`;

    setEmbeddedWalletBalances((currentBalances) => ({
      ...currentBalances,
      error: null,
      status: "loading",
    }));

    try {
      const balances = await fetchEmbeddedWalletBalances(address);
      setEmbeddedWalletBalances({
        error: null,
        eth: balances.eth,
        refreshedAt: new Date().toISOString(),
        status: "success",
        usdc: balances.usdc,
      });
    } catch (error) {
      setEmbeddedWalletBalances((currentBalances) => ({
        ...currentBalances,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load embedded wallet balances.",
        status: "error",
      }));
    }
  }

  useEffect(() => {
    if (selectedFlow !== "embedded" || !embeddedWalletSession.evmAddress) {
      return;
    }

    let cancelled = false;
    const address = embeddedWalletSession.evmAddress as `0x${string}`;

    setEmbeddedWalletBalances((currentBalances) => ({
      ...currentBalances,
      error: null,
      status: "loading",
    }));

    fetchEmbeddedWalletBalances(address)
      .then((balances) => {
        if (cancelled) {
          return;
        }

        setEmbeddedWalletBalances({
          error: null,
          eth: balances.eth,
          refreshedAt: new Date().toISOString(),
          status: "success",
          usdc: balances.usdc,
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setEmbeddedWalletBalances((currentBalances) => ({
          ...currentBalances,
          error:
            error instanceof Error
              ? error.message
              : "Unable to load embedded wallet balances.",
          status: "error",
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [embeddedWalletSession.evmAddress, selectedFlow]);

  useEffect(() => {
    if (
      selectedFlow !== "embedded" ||
      embeddedFundingAsset !== "ETH" ||
      !embeddedWalletReady ||
      !embeddedWalletSession.evmAddress
    ) {
      setEmbeddedSwapQuote(createIdleEmbeddedSwapQuote());
      return;
    }

    let cancelled = false;
    const address = embeddedWalletSession.evmAddress as `0x${string}`;

    setEmbeddedSwapQuote((currentQuote) => ({
      ...currentQuote,
      error: null,
      status: "loading",
    }));

    const timeoutId = window.setTimeout(() => {
      createEmbeddedEthSwapPlan({
        account: address,
        targetUsdcAtomic: totalAmountAtomicUsdc,
      })
        .then((plan) => {
          if (cancelled) {
            return;
          }

          setEmbeddedSwapQuote(toEmbeddedSwapQuoteState(plan));
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }

          setEmbeddedSwapQuote(
            createEmbeddedSwapQuoteError(
              error instanceof Error
                ? error.message
                : "Unable to quote Base ETH -> USDC swap.",
            ),
          );
        });
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    embeddedFundingAsset,
    embeddedWalletReady,
    embeddedWalletSession.evmAddress,
    selectedFlow,
    totalAmountAtomicUsdc,
  ]);

  useEffect(() => {
    if (!trackedHostedCheckoutId) {
      return;
    }

    const checkoutId = trackedHostedCheckoutId;
    const currentStatus =
      liveCheckouts.find((checkout) => checkout.id === checkoutId)?.status ?? null;

    if (currentStatus && hostedTerminalStatuses.has(currentStatus)) {
      return;
    }

    let cancelled = false;

    async function refreshCheckout() {
      try {
        const nextState = await fetchDemoStateFromServer();

        if (!cancelled) {
          startTransition(() => {
            setDemoState(nextState);
          });
        }
      } catch {
        if (!cancelled) {
          setCheckoutErrorMessage("Unable to refresh hosted checkout status.");
        }
      }
    }

    void refreshCheckout();

    const intervalId = window.setInterval(() => {
      void refreshCheckout();
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [liveCheckouts, trackedHostedCheckoutId]);

  useEffect(() => {
    if (!trackedEmbeddedWalletCheckoutId) {
      return;
    }

    const checkoutId = trackedEmbeddedWalletCheckoutId;
    let cancelled = false;

    async function loadAttempt() {
      try {
        const response = await fetch(
          `/api/coinbase/agentic-payments?checkoutId=${encodeURIComponent(checkoutId)}`,
          {
            cache: "no-store",
          },
        );
        const data = (await response.json()) as AgenticPaymentResponse;

        if (!response.ok) {
          throw new Error(data.error || "Unable to refresh embedded payment.");
        }

        if (!cancelled && data.attempt) {
          setEmbeddedWalletAttempt(data.attempt);
        }
      } catch (error) {
        if (!cancelled) {
          setCheckoutErrorMessage(
            error instanceof Error
              ? error.message
              : "Unable to refresh embedded payment.",
          );
        }
      }
    }

    void loadAttempt();

    if (isAttemptTerminal(currentEmbeddedWalletAttempt?.stage)) {
      return () => {
        cancelled = true;
      };
    }

    const intervalId = window.setInterval(() => {
      void loadAttempt();
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [currentEmbeddedWalletAttempt?.stage, trackedEmbeddedWalletCheckoutId]);

  useEffect(() => {
    if (!trackedHeadlessCheckoutId) {
      return;
    }

    const checkoutId = trackedHeadlessCheckoutId;
    let cancelled = false;

    async function loadAttempt() {
      try {
        const response = await fetch(
          `/api/coinbase/agentic-payments?checkoutId=${encodeURIComponent(checkoutId)}`,
          {
            cache: "no-store",
          },
        );
        const data = (await response.json()) as AgenticPaymentResponse;

        if (!response.ok) {
          throw new Error(data.error || "Unable to refresh headless payment.");
        }

        if (!cancelled && data.attempt) {
          setHeadlessAttempt(data.attempt);
        }
      } catch (error) {
        if (!cancelled) {
          setCheckoutErrorMessage(
            error instanceof Error
              ? error.message
              : "Unable to refresh headless payment.",
          );
        }
      }
    }

    void loadAttempt();

    if (isAttemptTerminal(currentHeadlessAttempt?.stage)) {
      return () => {
        cancelled = true;
      };
    }

    const intervalId = window.setInterval(() => {
      void loadAttempt();
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [currentHeadlessAttempt?.stage, trackedHeadlessCheckoutId]);

  useEffect(() => {
    if (!pushToken || isTerminalPushStatus(pushCharge?.status)) {
      return;
    }

    const token = pushToken;
    let cancelled = false;

    async function syncPushCharge() {
      try {
        const nextCharge = await fetchPushChargeFromServer(token);

        if (!cancelled) {
          setPushCharge(nextCharge);
        }
      } catch (error) {
        if (!cancelled) {
          setPushErrorMessage(
            error instanceof Error
              ? error.message
              : "Unable to refresh push payment.",
          );
        }
      }
    }

    void syncPushCharge();

    const intervalId = window.setInterval(() => {
      void syncPushCharge();
    }, 6000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [pushCharge?.status, pushToken]);

  function prepareMetadata(
    flow: DemoFlow,
    automaticMetadata: Record<string, string> = {},
  ) {
    const customMetadata = buildCustomMetadata(metadataFields);
    const metadata = buildCheckoutMetadata(flow, customMetadata, automaticMetadata);
    setSubmittedMetadata(metadata);

    return {
      customMetadata,
      metadata,
    };
  }

  async function createOfficialCheckoutForFlow(
    flow: DemoFlow,
    automaticMetadata: Record<string, string> = {},
  ) {
    const { metadata } = prepareMetadata(flow, automaticMetadata);
    const response = await fetch("/api/coinbase/checkouts", {
      body: JSON.stringify({
        amount: totalAmount.toFixed(2),
        description: `${flowLabels[flow]} · $0.01 test payment`,
        environment,
        metadata,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const data = (await response.json()) as
      | CreateCheckoutResponse
      | CreateCheckoutErrorResponse;

    if (!response.ok || !("checkout" in data)) {
      const errorMessage =
        "error" in data ? data.error : "Unable to create checkout.";
      throw new Error(errorMessage ?? "Unable to create checkout.");
    }

    startTransition(() => {
      setDemoState(data.demoState);
    });
    persistReceiptContext(environment, data.checkout);

    return data.checkout;
  }

  async function handleCreateHostedCheckout() {
    try {
      setCheckoutCreating(true);
      resetMessages();
      setEmbeddedWalletAttempt(null);
      setHeadlessAttempt(null);
      const checkout = await createOfficialCheckoutForFlow("hosted");
      setTrackedHostedCheckoutId(checkout.id);
    } catch (error) {
      setCheckoutErrorMessage(
        error instanceof Error ? error.message : "Unable to create checkout.",
      );
    } finally {
      setCheckoutCreating(false);
    }
  }

  async function handleCreateEmbeddedCheckout() {
    if (environment !== "live") {
      setCheckoutErrorMessage("Embedded flow is live-only.");
      return;
    }

    if (!embeddedWalletReady || !embeddedWalletSession.evmAddress) {
      setCheckoutErrorMessage("Sign in with the embedded wallet first.");
      return;
    }

    try {
      setCheckoutCreating(true);
      resetMessages();
      setEmbeddedWalletAttempt(null);
      setEmbeddedPaymentPhase(null);
      setEmbeddedSwapReceipt(null);
      setHeadlessAttempt(null);

      const payerAddress = embeddedWalletSession.evmAddress as `0x${string}`;
      let embeddedSwapPlan: EmbeddedSwapPlan | null = null;

      if (embeddedFundingAsset === "ETH") {
        setEmbeddedPaymentPhase("Calculating Base ETH needed for $0.01 USDC...");
        embeddedSwapPlan = await createEmbeddedEthSwapPlan({
          account: payerAddress,
          targetUsdcAtomic: totalAmountAtomicUsdc,
        });
        setEmbeddedSwapQuote(toEmbeddedSwapQuoteState(embeddedSwapPlan));
      }

      const fundingMetadata: Record<string, string> =
        embeddedFundingAsset === "ETH"
          ? {
              fundingAsset: "ETH",
              fundingNetwork: "base",
              fundingRoute: "swap-to-usdc",
              swapExpectedUsdc: embeddedSwapPlan?.expectedUsdc ?? "pending",
              swapFromAmountEth: embeddedSwapPlan?.fromAmountEth ?? "pending",
              swapMinUsdc: embeddedSwapPlan?.minUsdc ?? "pending",
            }
          : {
              fundingAsset: "USDC",
              fundingNetwork: "base",
              fundingRoute: "direct-usdc",
            };
      const checkout = await createOfficialCheckoutForFlow(
        "embedded",
        fundingMetadata,
      );
      setTrackedEmbeddedWalletCheckoutId(checkout.id);
      setEmbeddedPaymentPhase("Checkout created. Resolving payment payload...");

      const resolutionResponse = await fetch("/api/coinbase/agentic-payments", {
        body: JSON.stringify({
          checkoutId: checkout.id,
          dryRun: true,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const resolutionData =
        (await resolutionResponse.json()) as AgenticPaymentResponse;

      if (!resolutionResponse.ok || !resolutionData.attempt) {
        throw new Error(
          resolutionData.error || "Unable to resolve embedded payment payload.",
        );
      }

      setEmbeddedWalletAttempt(resolutionData.attempt);

      if (!isSerializableAuthorizationRequest(resolutionData.attempt.paymentInfo)) {
        throw new Error("Resolver did not return a valid authorization payload.");
      }

      if (embeddedFundingAsset === "ETH") {
        const swapPlan =
          embeddedSwapPlan ??
          (await createEmbeddedEthSwapPlan({
            account: payerAddress,
            targetUsdcAtomic: totalAmountAtomicUsdc,
          }));

        setEmbeddedPaymentPhase("Submitting swap transaction...");
        const { executeSwap } = await import("@coinbase/cdp-core");
        const swapResult = await executeSwap({
          account: payerAddress,
          fromAmount: swapPlan.fromAmountAtomic,
          fromToken: EVM_NATIVE_TOKEN_ADDRESS,
          idempotencyKey: `coinbiz-${checkout.id}-eth-usdc`,
          network: "base",
          slippageBps: EMBEDDED_SWAP_SLIPPAGE_BPS,
          toToken: BASE_USDC_ADDRESS,
        });

        if (swapResult.type !== "evm-eoa") {
          throw new Error(
            "Smart-account swap submission is not enabled for this demo yet.",
          );
        }

        setEmbeddedSwapReceipt({
          expectedUsdc: formatAtomicTokenAmount(swapResult.toAmount, USDC_DECIMALS),
          fromAmountEth: swapPlan.fromAmountEth,
          minUsdc: formatAtomicTokenAmount(swapResult.minToAmount, USDC_DECIMALS),
          status: "submitted",
          transactionHash: swapResult.transactionHash,
        });

        setEmbeddedPaymentPhase("Waiting for swap confirmation...");
        const swapReceipt = await basePublicClient.waitForTransactionReceipt({
          hash: swapResult.transactionHash as Hex,
        });

        if (swapReceipt.status !== "success") {
          throw new Error("ETH -> USDC swap transaction did not complete.");
        }

        setEmbeddedSwapReceipt({
          expectedUsdc: formatAtomicTokenAmount(swapResult.toAmount, USDC_DECIMALS),
          fromAmountEth: swapPlan.fromAmountEth,
          minUsdc: formatAtomicTokenAmount(swapResult.minToAmount, USDC_DECIMALS),
          status: "confirmed",
          transactionHash: swapResult.transactionHash,
        });
        setEmbeddedPaymentPhase("Swap confirmed. Signing payment authorization...");
        void refreshEmbeddedWalletBalances();
      } else {
        setEmbeddedPaymentPhase("Signing payment authorization...");
      }

      const { signEvmTypedData } = await import("@coinbase/cdp-core");
      const signedResult = await signEvmTypedData({
        evmAccount: payerAddress,
        typedData: toEmbeddedWalletTypedData(
          resolutionData.attempt.paymentInfo,
          payerAddress,
        ),
      });

      setEmbeddedPaymentPhase("Submitting payment to Coinbase...");
      const submissionResponse = await fetch("/api/coinbase/agentic-payments", {
        body: JSON.stringify({
          checkoutId: checkout.id,
          payerAddress,
          signature: signedResult.signature,
          waitForCompletion: false,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const submissionData =
        (await submissionResponse.json()) as AgenticPaymentResponse;

      if (!submissionResponse.ok && !submissionData.attempt) {
        throw new Error(
          submissionData.error || "Unable to submit embedded payment.",
        );
      }

      if (submissionData.attempt) {
        setEmbeddedWalletAttempt(submissionData.attempt);
      }
      setEmbeddedPaymentPhase("Payment submitted. Waiting for receipt...");
      void refreshEmbeddedWalletBalances();
    } catch (error) {
      setCheckoutErrorMessage(
        error instanceof Error ? error.message : "Unable to submit payment.",
      );
      setEmbeddedPaymentPhase(null);
    } finally {
      setCheckoutCreating(false);
    }
  }

  async function handleCreateHeadlessCheckout() {
    if (environment !== "live") {
      setCheckoutErrorMessage("Headless flow is live-only.");
      return;
    }

    try {
      setHeadlessCreating(true);
      resetMessages();
      setEmbeddedWalletAttempt(null);
      setHeadlessAttempt(null);

      const checkout = await createOfficialCheckoutForFlow("headless");
      setTrackedHeadlessCheckoutId(checkout.id);

      const paymentResponse = await fetch("/api/coinbase/agentic-payments", {
        body: JSON.stringify({
          checkoutId: checkout.id,
          waitForCompletion: false,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const paymentData = (await paymentResponse.json()) as AgenticPaymentResponse;

      if (!paymentResponse.ok && !paymentData.attempt) {
        throw new Error(paymentData.error || "Unable to submit headless payment.");
      }

      if (paymentData.attempt) {
        setHeadlessAttempt(paymentData.attempt);
      }
    } catch (error) {
      setCheckoutErrorMessage(
        error instanceof Error ? error.message : "Unable to submit payment.",
      );
    } finally {
      setHeadlessCreating(false);
    }
  }

  async function handleCreatePushCharge() {
    if (environment !== "live") {
      setPushErrorMessage("Push flow is live-only.");
      return;
    }

    try {
      setPushCreating(true);
      resetMessages();

      const { metadata } = prepareMetadata("push");
      const response = await fetch("/api/coinbase/push-charges", {
        body: JSON.stringify({
          amountUsd: totalAmount.toFixed(2),
          asset: pushAsset,
          environment,
          metadata,
          network: pushAsset === "ETH" ? pushNetwork : BITCOIN_NETWORK,
          reference: metadata.reference,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      const data = (await response.json()) as
        | CreatePushChargeResponse
        | PushChargeErrorResponse;

      if (!response.ok || !("charge" in data) || !("token" in data)) {
        const errorMessage =
          "error" in data ? data.error : "Unable to create push payment.";
        throw new Error(errorMessage ?? "Unable to create push payment.");
      }

      setPushCharge(data.charge);
      setPushToken(data.token);
    } catch (error) {
      setPushErrorMessage(
        error instanceof Error ? error.message : "Unable to create push payment.",
      );
    } finally {
      setPushCreating(false);
    }
  }

  function handleBack() {
    if (wizardStep === "experience") {
      setWizardStep("flow");
      return;
    }

    if (wizardStep === "flow") {
      setWizardStep("environment");
      return;
    }

    if (wizardStep === "environment") {
      setWizardStep("intro");
    }
  }

  function handleStart() {
    resetMessages();
    setWizardStep("environment");
  }

  function handleSelectEnvironment(nextEnvironment: CheckoutEnvironment) {
    resetMessages();
    setEnvironment(nextEnvironment);
    setSelectedFlow(null);
    setWizardStep("flow");
  }

  function isFlowAvailable(flow: DemoFlow) {
    return environment === "live" || flow === "hosted";
  }

  function handleSelectFlow(flow: DemoFlow) {
    if (!isFlowAvailable(flow)) {
      return;
    }

    resetMessages();
    setSelectedFlow(flow);
    setWizardStep("experience");
  }

  async function handleSelectedFlowAction() {
    if (!selectedFlow) {
      return;
    }

    if (selectedFlow === "hosted") {
      await handleCreateHostedCheckout();
      return;
    }

    if (selectedFlow === "embedded") {
      await handleCreateEmbeddedCheckout();
      return;
    }

    if (selectedFlow === "headless") {
      await handleCreateHeadlessCheckout();
      return;
    }

    await handleCreatePushCharge();
  }

  const selectedCheckout =
    selectedFlow === "hosted"
      ? currentHostedCheckout
      : selectedFlow === "embedded"
        ? (trackedEmbeddedWalletCheckoutId
            ? liveCheckouts.find(
                (checkout) => checkout.id === trackedEmbeddedWalletCheckoutId,
              ) ?? activeCheckout
            : activeCheckout)
        : selectedFlow === "headless"
          ? (trackedHeadlessCheckoutId
              ? liveCheckouts.find(
                  (checkout) => checkout.id === trackedHeadlessCheckoutId,
                ) ?? activeCheckout
              : activeCheckout)
          : null;

  const selectedAttempt =
    selectedFlow === "embedded"
      ? currentEmbeddedWalletAttempt
      : selectedFlow === "headless"
        ? currentHeadlessAttempt
        : null;

  const actionDisabled =
    !selectedFlow ||
    !demoState.credentialsConfigured ||
    checkoutCreating ||
    headlessCreating ||
    pushCreating ||
    (selectedFlow === "embedded" && !embeddedWalletReady);
  const selectedActionDisabled =
    actionDisabled || (selectedFlow === "embedded" && !embeddedEthSwapReady);

  const actionLabel =
    selectedFlow === "hosted"
      ? checkoutCreating
        ? "Creating..."
        : "Create hosted checkout"
      : selectedFlow === "embedded"
        ? checkoutCreating
          ? embeddedFundingAsset === "ETH"
            ? "Swapping & paying..."
            : "Submitting..."
          : embeddedWalletReady
            ? embeddedFundingAsset === "ETH"
              ? "Swap ETH & pay $0.01"
              : "Pay $0.01 with embedded wallet"
            : "Sign in to continue"
        : selectedFlow === "headless"
          ? headlessCreating
            ? "Submitting..."
            : "Submit headless payment"
          : pushCreating
            ? "Generating..."
            : "Create push payment";
  const receiptCard = renderReceiptCard();

  function renderReceiptCard() {
    if (selectedFlow === "hosted") {
      if (!selectedCheckout) {
        return (
          <p className="text-sm leading-7 text-[var(--ink-soft)]">
            Create the checkout and the receipt will appear here.
          </p>
        );
      }

      const isCompleted = selectedCheckout.status === "COMPLETED";
      const receiptMetadata = getReceiptMetadata(
        submittedMetadata,
        selectedCheckout,
      );
      const txUrl = selectedCheckout.transactionHash
        ? getNetworkExplorerUrl(
            selectedCheckout.network,
            selectedCheckout.transactionHash,
          )
        : undefined;

      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Receipt</p>
              <h3 className="display-font mt-2 text-2xl font-semibold tracking-[-0.03em]">
                {isCompleted ? "Payment completed" : "Checkout created"}
              </h3>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${getStatusStyle(
                selectedCheckout.status,
              )}`}
            >
              {formatStatusLabel(selectedCheckout.status)}
            </span>
          </div>

          <div className="divide-y divide-[var(--line)] rounded-[1.5rem] border border-[var(--line)] bg-[#f7f9ff] px-4 py-2">
            <ReceiptField label="Amount" value={formatAmount(selectedCheckout.amount)} />
            <ReceiptField label="Reference" value={getReference(receiptMetadata)} />
            <ReceiptField label="Checkout ID" mono value={selectedCheckout.id} />
            <ReceiptField
              href={selectedCheckout.url}
              label="Payment URL"
              mono
              value={selectedCheckout.url}
            />
            <ReceiptField label="Network" value={formatStatusLabel(selectedCheckout.network)} />
            <ReceiptField
              label="Transaction hash"
              mono
              href={txUrl}
              value={selectedCheckout.transactionHash ?? "Pending"}
            />
            <ReceiptField
              label="Created"
              value={formatTimestamp(selectedCheckout.createdAt)}
            />
            <ReceiptField
              label="Last updated"
              value={formatTimestamp(
                selectedCheckout.updatedAt ?? selectedCheckout.createdAt,
              )}
            />
          </div>

          {!isCompleted ? (
            <button
              className="rounded-full bg-[var(--accent-strong)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent)] hover:shadow-[0_14px_44px_rgba(54,103,255,0.28)]"
              onClick={() =>
                window.open(selectedCheckout.url, "_blank", "noopener,noreferrer")
              }
              type="button"
            >
              Open hosted checkout
            </button>
          ) : null}

          <MetadataPreview metadata={receiptMetadata} />
        </div>
      );
    }

    if (selectedFlow === "embedded" || selectedFlow === "headless") {
      if (!selectedAttempt) {
        return null;
      }

      const isCompleted = selectedAttempt.stage === "completed";
      const isFailed = selectedAttempt.stage === "failed";
      const attemptCheckout = getAttemptCheckout(selectedAttempt);
      const receiptMetadata = getReceiptMetadata(submittedMetadata, attemptCheckout);
      const network = attemptCheckout?.network ?? selectedAttempt.network;
      const txHash = selectedAttempt.txHash ?? attemptCheckout?.transactionHash;
      const txUrl = txHash ? getNetworkExplorerUrl(network, txHash) : undefined;

      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Receipt</p>
              <h3 className="display-font mt-2 text-2xl font-semibold tracking-[-0.03em]">
                {isCompleted
                  ? "Payment completed"
                  : isFailed
                    ? "Payment failed"
                    : "Payment in progress"}
              </h3>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${getAttemptStageStyle(
                selectedAttempt.stage,
              )}`}
            >
              {formatAttemptStage(selectedAttempt.stage)}
            </span>
          </div>

          <div className="divide-y divide-[var(--line)] rounded-[1.5rem] border border-[var(--line)] bg-[#f7f9ff] px-4 py-2">
            <ReceiptField label="Amount" value={formatAmount(selectedAttempt.amount)} />
            <ReceiptField label="Reference" value={getReference(receiptMetadata)} />
            <ReceiptField label="Checkout ID" mono value={selectedAttempt.checkoutId} />
            {selectedFlow === "embedded" ? (
              <>
                <ReceiptField
                  label="Email"
                  value={embeddedWalletSession.email ?? "Authenticated"}
                />
                <ReceiptField
                  label="Funding"
                  value={
                    embeddedFundingAsset === "ETH"
                      ? "Base ETH swapped to USDC"
                      : "Base USDC"
                  }
                />
                {embeddedSwapReceipt?.transactionHash ? (
                  <ReceiptField
                    href={getNetworkExplorerUrl(
                      "base",
                      embeddedSwapReceipt.transactionHash,
                    )}
                    label="Swap tx"
                    mono
                    value={embeddedSwapReceipt.transactionHash}
                  />
                ) : null}
              </>
            ) : (
              <ReceiptField
                label="Server signer"
                mono
                value={selectedAttempt.payerAddress ?? "Pending"}
              />
            )}
            <ReceiptField label="Network" value={formatStatusLabel(network)} />
            <ReceiptField
              href={txUrl}
              label="Transaction hash"
              mono
              value={txHash ?? "Pending"}
            />
            {selectedFlow === "headless" ? (
              <>
                <ReceiptField
                  label="Request ID"
                  mono
                  value={selectedAttempt.submissionRequestId ?? "Pending"}
                />
                <ReceiptField
                  label="Correlation ID"
                  mono
                  value={selectedAttempt.correlationId}
                />
              </>
            ) : null}
            <ReceiptField
              label="Created"
              value={formatTimestamp(
                attemptCheckout?.createdAt ?? selectedAttempt.createdAt,
              )}
            />
            <ReceiptField
              label="Last updated"
              value={formatTimestamp(
                attemptCheckout?.updatedAt ?? selectedAttempt.updatedAt,
              )}
            />
          </div>

          {selectedAttempt.errorMessage ? (
            <div className="rounded-[1.5rem] border border-[#efc8c3] bg-[#fbefed] px-4 py-3 text-sm text-[#8f352d]">
              {selectedAttempt.errorMessage}
            </div>
          ) : null}

          <MetadataPreview metadata={receiptMetadata} />
        </div>
      );
    }

    if (selectedFlow === "push") {
      if (!pushCharge) {
        return (
          <p className="text-sm leading-7 text-[var(--ink-soft)]">
            Create the push payment and the receive details will appear here.
          </p>
        );
      }

      const receiptMetadata = getReceiptMetadata(submittedMetadata, null);
      const latestTransactionUrl = getPushTransactionUrl(pushCharge);

      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Receipt</p>
              <h3 className="display-font mt-2 text-2xl font-semibold tracking-[-0.03em]">
                {pushCharge.status === "paid"
                  ? "Payment received"
                  : "Waiting for payment"}
              </h3>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${getStatusStyle(
                pushCharge.status,
              )}`}
            >
              {formatStatusLabel(pushCharge.status)}
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-[180px_1fr]">
            <div className="aspect-square rounded-[1.5rem] border border-[var(--line)] bg-white p-4 shadow-[0_18px_42px_rgba(54,103,255,0.1)]">
              <Image
                alt={`${pushCharge.asset} payment QR code`}
                className="h-full w-full rounded-[1rem] object-contain"
                height={PUSH_QR_SIZE}
                sizes="180px"
                src={getPushQrImageUrl(pushQrValue ?? pushCharge.address)}
                width={PUSH_QR_SIZE}
              />
            </div>

            <div className="divide-y divide-[var(--line)] rounded-[1.5rem] border border-[var(--line)] bg-[#f7f9ff] px-4 py-2">
              <ReceiptField label="Asset" value={pushCharge.asset} />
              <ReceiptField
                label="Quoted amount"
                value={`${pushCharge.quotedAmount} ${pushCharge.asset}`}
              />
              <ReceiptField label="USD amount" value={formatAmount(pushCharge.amountUsd, "USD")} />
              <ReceiptField label="Network" value={formatStatusLabel(pushCharge.network)} />
              <ReceiptField label="Address" mono value={pushCharge.address} />
              <ReceiptField
                label="Received"
                value={`${pushCharge.payment.totalReceivedAmount} ${pushCharge.asset}`}
              />
              <ReceiptField
                href={latestTransactionUrl}
                label="Latest transaction"
                mono
                value={pushCharge.payment.latestTransactionHash ?? "Pending"}
              />
              <ReceiptField
                label="Expires"
                value={formatTimestamp(pushCharge.payment.expiresAt)}
              />
            </div>
          </div>

          <MetadataPreview metadata={receiptMetadata} />
        </div>
      );
    }

    return null;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-10 lg:px-8">
      {wizardStep === "intro" ? (
        <section className="flex min-h-[82vh] flex-1 items-center justify-center">
          <div className="w-full max-w-3xl rounded-[2.5rem] border border-[#9bb6ff]/65 bg-[linear-gradient(160deg,#5f86ff_0%,#3d6eff_52%,#1e4fe4_100%)] px-10 py-16 text-center text-white shadow-[0_28px_82px_rgba(54,103,255,0.34)]">
            <h1 className="display-font text-5xl font-semibold tracking-[-0.06em] sm:text-7xl">
              Coinbase Business Demo
            </h1>
            <div className="mt-10">
              <button
                className="rounded-full bg-white px-8 py-4 text-sm font-semibold text-[#1e4fe4] transition hover:shadow-[0_18px_48px_rgba(255,255,255,0.28)]"
                onClick={handleStart}
                type="button"
              >
                Start
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {wizardStep === "environment" ? (
        <section className="space-y-8">
          <StepHeader
            onBack={handleBack}
            stepLabel="Step 1 of 3"
            title="Live or Sandbox"
          />

          <div className="grid gap-4 md:grid-cols-2">
            {(["live", "sandbox"] as CheckoutEnvironment[]).map((value) => (
              <button
                key={value}
                className={getSelectionTileClassName(environment === value)}
                onClick={() => handleSelectEnvironment(value)}
                type="button"
              >
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-100/85">
                    {environmentLabels[value]}
                  </p>
                  <h2 className="display-font text-3xl font-semibold tracking-[-0.04em]">
                    {value === "live" ? "Base mainnet" : "Sandbox"}
                  </h2>
                  <p className="max-w-sm text-sm leading-7 text-blue-50/88">
                    {value === "live"
                      ? "Use live mode for embedded, headless, and push payments."
                      : "Use sandbox when you only want to test the hosted checkout path."}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {wizardStep === "flow" ? (
        <section className="space-y-8">
          <StepHeader onBack={handleBack} stepLabel="Step 2 of 3" title="Choose Flow" />

          <div className="grid gap-4 md:grid-cols-2">
            {(
              [
                {
                  description: "Create a checkout and open Coinbase's hosted payment page.",
                  value: "hosted",
                },
                {
                  description: "Create a checkout and complete it with the embedded wallet.",
                  value: "embedded",
                },
                {
                  description: "Create a checkout and let the server signer complete payment.",
                  value: "headless",
                },
                {
                  description: "Generate a direct BTC or ETH payment request.",
                  value: "push",
                },
              ] satisfies Array<{
                description: string;
                value: DemoFlow;
              }>
            ).map((flow) => {
              const available = isFlowAvailable(flow.value);

              return (
                <button
                  key={flow.value}
                  className={
                    available
                      ? getSelectionTileClassName(selectedFlow === flow.value)
                      : getDisabledTileClassName()
                  }
                  disabled={!available}
                  onClick={() => handleSelectFlow(flow.value)}
                  type="button"
                >
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-100/85">
                        {flowLabels[flow.value]}
                      </p>
                      {!available ? (
                        <span className="rounded-full border border-white/30 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/90">
                          Live only
                        </span>
                      ) : null}
                    </div>
                    <h2 className="display-font text-3xl font-semibold tracking-[-0.04em]">
                      {flowLabels[flow.value]}
                    </h2>
                    <p className="max-w-sm text-sm leading-7 text-blue-50/88">
                      {flow.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {wizardStep === "experience" && selectedFlow ? (
        <section className="space-y-8">
          <StepHeader onBack={handleBack} stepLabel="Step 3 of 3" title={selectedFlowTitle!} />

          <div className="mx-auto w-full max-w-3xl space-y-5">
            {selectedFlow === "embedded" ? (
              <div className="rounded-[2rem] border border-[var(--line)] bg-white/86 p-6 shadow-[0_18px_50px_rgba(54,103,255,0.12)]">
                {embeddedWalletConfig.projectId ? (
                  <EmbeddedWalletPanel config={embeddedWalletConfig} variant="compact" />
                ) : (
                  <div className="space-y-2">
                    <p className="eyebrow">Embedded Wallet</p>
                    <h2 className="display-font text-2xl font-semibold tracking-[-0.03em]">
                      Missing CDP project ID
                    </h2>
                    <p className="text-sm leading-7 text-[var(--ink-soft)]">
                      Add
                      {" "}
                      <span className="font-mono text-[var(--foreground)]">
                        NEXT_PUBLIC_CDP_PROJECT_ID
                      </span>
                      {" "}
                      to enable embedded wallet sign-in.
                    </p>
                  </div>
                )}
              </div>
            ) : null}

            {selectedFlow === "headless" ? (
              <HeadlessExecutionLog
                attempt={currentHeadlessAttempt}
                checkout={selectedCheckout}
              />
            ) : null}

            <div className="rounded-[2rem] border border-[var(--line)] bg-white/86 p-6 shadow-[0_18px_50px_rgba(54,103,255,0.12)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <p className="eyebrow">Payment</p>
                  <h2 className="display-font text-3xl font-semibold tracking-[-0.04em]">
                    $0.01 test payment
                  </h2>
                  {selectedFlow === "embedded" ? null : (
                    <p className="text-sm leading-7 text-[var(--ink-soft)]">
                      {selectedFlow === "hosted"
                        ? "Create the hosted checkout and open it when you are ready."
                        : selectedFlow === "headless"
                          ? "Let the server signer handle the payment with no browser wallet handoff."
                          : "Generate a direct BTC or ETH payment request for the same amount."}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-[var(--line)] bg-[#f7f9ff] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                    {environmentLabels[environment]}
                  </span>
                  <span className="rounded-full border border-[var(--line)] bg-[#f7f9ff] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                    {selectedFlowTitle}
                  </span>
                </div>
              </div>

              {selectedFlow === "push" ? (
                <div className="mt-6 flex flex-wrap gap-3">
                  {pushAssetOptions.map((asset) => (
                    <button
                      key={asset}
                      className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                        pushAsset === asset
                          ? "border-[var(--accent-strong)] bg-[var(--accent-strong)] text-white shadow-[0_10px_35px_rgba(54,103,255,0.24)]"
                          : "border-[var(--line)] bg-white text-[var(--foreground)] hover:border-[var(--accent-strong)] hover:shadow-[0_10px_30px_rgba(54,103,255,0.14)]"
                      }`}
                      onClick={() => {
                        setPushAsset(asset);
                        setPushNetwork(
                          asset === "ETH" ? "ethereum" : BITCOIN_NETWORK,
                        );
                      }}
                      type="button"
                    >
                      {asset}
                    </button>
                  ))}

                  {pushAsset === "ETH"
                    ? ethNetworkOptions.map((option) => (
                        <button
                          key={option.network}
                          className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                            pushNetwork === option.network
                              ? "border-[var(--accent-strong)] bg-[var(--accent-strong)] text-white shadow-[0_10px_35px_rgba(54,103,255,0.24)]"
                              : "border-[var(--line)] bg-white text-[var(--foreground)] hover:border-[var(--accent-strong)] hover:shadow-[0_10px_30px_rgba(54,103,255,0.14)]"
                          }`}
                          onClick={() => setPushNetwork(option.network)}
                          type="button"
                        >
                          {option.label}
                        </button>
                      ))
                    : null}
                </div>
              ) : null}

              {selectedFlow === "embedded" ? (
                <EmbeddedFundingControls
                  balances={embeddedWalletBalances}
                  fundingAsset={embeddedFundingAsset}
                  isReady={embeddedWalletReady}
                  onFundingAssetChange={(asset) => {
                    setEmbeddedFundingAsset(asset);
                    setEmbeddedPaymentPhase(null);
                    setEmbeddedSwapReceipt(null);
                  }}
                  onRefreshBalances={() => void refreshEmbeddedWalletBalances()}
                  paymentAmountAtomicUsdc={totalAmountAtomicUsdc}
                  paymentPhase={embeddedPaymentPhase}
                  quote={embeddedSwapQuote}
                  swapReceipt={embeddedSwapReceipt}
                />
              ) : null}

              <div className="mt-6 rounded-[1.5rem] border border-[var(--line)] bg-[#f7f9ff] px-5 py-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                      {TEST_CART.title}
                    </p>
                    {TEST_CART.caption ? (
                      <p className="mt-1 text-sm text-[var(--ink-soft)]">
                        {TEST_CART.caption}
                      </p>
                    ) : null}
                  </div>
                  <p className="text-lg font-semibold text-[var(--foreground)]">
                    {formatAmount(TEST_CART.unitAmount)}
                  </p>
                </div>
              </div>

              <MetadataFieldsEditor
                fields={metadataFields}
                onAdd={addMetadataField}
                onRemove={removeMetadataField}
                onUpdate={updateMetadataField}
              />

              <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-soft)]">
                    Total
                  </p>
                  <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                    {formatAmount(totalAmount, selectedFlow === "push" ? "USD" : "USDC")}
                  </p>
                </div>

                <button
                  className="rounded-full bg-[var(--accent-strong)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent)] hover:shadow-[0_14px_44px_rgba(54,103,255,0.28)] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={selectedActionDisabled}
                  onClick={() => void handleSelectedFlowAction()}
                  type="button"
                >
                  {actionLabel}
                </button>
              </div>

              {currentErrorMessage ? (
                <div className="mt-5 rounded-[1.5rem] border border-[#efc8c3] bg-[#fbefed] px-4 py-3 text-sm leading-6 text-[#8f352d]">
                  {currentErrorMessage}
                </div>
              ) : null}
            </div>

            {receiptCard ? (
              <div className="rounded-[2rem] border border-[var(--line)] bg-white/86 p-6 shadow-[0_18px_50px_rgba(54,103,255,0.12)]">
                {receiptCard}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
