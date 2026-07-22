"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import {
  startTransition,
  useEffect,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
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
  AgentChatMessage,
  AgentCheckoutPublicView,
} from "@/app/lib/agent-checkout-types";
import type {
  CheckoutEnvironment,
  CoinbaseCheckout,
  DemoStatePayload,
  PushAsset,
  PushChargeView,
  PushNetwork,
} from "@/app/lib/coinbase-types";
import type { EmbeddedWalletPanelConfig } from "@/components/cdp-embedded-wallet-panel";
import { CdsIcon } from "@/components/cds-icon";
import { DisintegrationField } from "@/components/disintegration-field";

const EmbeddedWalletPanel = dynamic(
  () =>
    import("@/components/cdp-embedded-wallet-panel").then(
      (module) => module.EmbeddedWalletPanel,
    ),
  {
    loading: () => (
      <div className="embedded-wallet-heading" aria-busy="true">
        <span className="wallet-status-orb" aria-hidden="true" />
        <div>
          <strong>Connecting wallet</strong>
          <small>Starting a secure session…</small>
        </div>
      </div>
    ),
    ssr: false,
  },
);

type CoinbaseDemoProps = {
  embeddedWalletConfig: EmbeddedWalletPanelConfig;
  initialState: DemoStatePayload;
};

type DemoFlow =
  | "hosted"
  | "embedded"
  | "headless"
  | "push"
  | "agent"
  | "x402";
type PublicDemoFlow = "hosted" | "embedded" | "push" | "x402";
type EmbeddedFundingAsset = "USDC" | "ETH";
type CreditAmountPreset = "0.01" | "1" | "10" | "100" | "other";
type WizardStep = "intro" | "environment" | "flow" | "experience";
type X402DemoStage =
  | "idle"
  | "requesting"
  | "payment_required"
  | "settling"
  | "complete"
  | "error";
type X402WorkloadId = "inference" | "gpu";

function isX402DemoRunning(stage: X402DemoStage) {
  return (
    stage === "requesting" ||
    stage === "payment_required" ||
    stage === "settling"
  );
}

function AnimatedLetterWave({
  startIndex = 0,
  text,
}: {
  startIndex?: number;
  text: string;
}) {
  const segments = text.split(/(\s+)/);

  return (
    <span className="headline-wave-text" aria-hidden="true">
      {segments.map((segment, segmentIndex) => {
        const segmentStart =
          startIndex +
          segments
            .slice(0, segmentIndex)
            .reduce((length, previousSegment) => length + previousSegment.length, 0);

        if (/^\s+$/.test(segment)) {
          return (
            <span className="headline-wave-space" key={`space-${segmentIndex}`}>
              {segment}
            </span>
          );
        }

        return (
          <span className="headline-wave-word" key={`${segment}-${segmentIndex}`}>
            {Array.from(segment).map((letter, index) => (
              <span
                className="headline-wave-letter"
                key={`${letter}-${index}`}
                style={
                  {
                    "--wave-index": segmentStart + index,
                  } as CSSProperties
                }
              >
                {letter}
              </span>
            ))}
          </span>
        );
      })}
    </span>
  );
}

type X402Exchange = {
  detail: string;
  label: string;
  status: string;
};

type X402ComputeResponse =
  | {
      result: {
        inputTokens: number;
        latencyMs: number;
        model: string;
        output: string;
        outputTokens: number;
      };
      simulation: boolean;
      workload: "inference";
    }
  | {
      result: {
        accelerator: string;
        durationSeconds: number;
        leaseId: string;
        region: string;
        status: "ready";
      };
      simulation: boolean;
      workload: "gpu";
    };

type X402WorkloadConfig = {
  actionLabel: string;
  description: string;
  eyebrow: string;
  priceUsdc: string;
  specs: Array<{ label: string; value: string }>;
  title: string;
  unit: string;
};

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

type CreateAgentCheckoutResponse = {
  checkout: AgentCheckoutPublicView;
};

type AgentCheckoutResponse = {
  checkout: AgentCheckoutPublicView;
};

type AgentChatResponse = {
  messages?: AgentChatMessage[];
  toolResults?: Array<{
    name: string;
    result: unknown;
  }>;
  error?: string;
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

const CREDIT_AMOUNT_PRESETS = [
  { label: "$0.01", value: "0.01" },
  { label: "$1", value: "1" },
  { label: "$10", value: "10" },
  { label: "$100", value: "100" },
  { label: "Other", value: "other" },
] satisfies Array<{ label: string; value: CreditAmountPreset }>;

const basePublicClient = createPublicClient({
  chain: base,
  transport: http(BASE_RPC_URL),
});

const environmentLabels: Record<CheckoutEnvironment, string> = {
  live: "Live",
  sandbox: "Sandbox",
};

const flowLabels: Record<DemoFlow, string> = {
  agent: "Agent",
  embedded: "Embedded Checkout",
  headless: "Headless",
  hosted: "Hosted Checkout",
  push: "Direct Transfer",
  x402: "x402",
};

const publicDemoFlows = [
  {
    description:
      "Send buyers to a secure Coinbase-hosted page and return them to your product when payment completes.",
    eyebrow: "Stablecoin checkout",
    index: "01",
    value: "hosted",
  },
  {
    description:
      "Keep the buyer inside your product while the same checkout lifecycle handles payment and status.",
    eyebrow: "In-product wallet",
    index: "02",
    value: "embedded",
  },
  {
    description:
      "Sell inference and GPU capacity per request with an HTTP 402 quote, payment proof, and automatic retry.",
    eyebrow: "Inference + GPUs",
    index: "03",
    value: "x402",
  },
  {
    description:
      "Create a wallet-native receive request for a direct BTC or ETH transfer.",
    eyebrow: "Wallet transfer",
    index: "04",
    value: "push",
  },
] satisfies Array<{
  description: string;
  eyebrow: string;
  index: string;
  value: PublicDemoFlow;
}>;

const publicModeDocs = {
  hosted: {
    href: "https://docs.cdp.coinbase.com/coinbase-business/checkout-apis/overview",
    label: "Checkout APIs",
  },
  embedded: {
    href: "https://docs.cdp.coinbase.com/wallets/client-side-development/react-components",
    label: "Wallet SDK",
  },
  x402: {
    href: "https://docs.cdp.coinbase.com/x402/welcome",
    label: "x402 protocol",
  },
  push: {
    href: "https://docs.cdp.coinbase.com/coinbase-app/transfer-apis/onchain-addresses",
    label: "Onchain addresses",
  },
} satisfies Record<PublicDemoFlow, { href: string; label: string }>;

const publicModeIcons = {
  embedded: "wallet",
  hosted: "browser",
  push: "sendReceive",
  x402: "api",
} as const;

const X402_WORKLOADS: Record<X402WorkloadId, X402WorkloadConfig> = {
  inference: {
    actionLabel: "Run paid inference",
    description:
      "Purchase one completion from an open-weight model without an account, subscription, or API key.",
    eyebrow: "Per completion",
    priceUsdc: "0.0025",
    specs: [
      { label: "Model", value: "Llama 3.3 70B" },
      { label: "Context", value: "4K tokens" },
      { label: "Max output", value: "512 tokens" },
    ],
    title: "LLM inference",
    unit: "One generated completion",
  },
  gpu: {
    actionLabel: "Reserve GPU burst",
    description:
      "Purchase a short H100 compute window for a burst workload, metered to a fixed duration.",
    eyebrow: "Per compute window",
    priceUsdc: "0.0250",
    specs: [
      { label: "Accelerator", value: "NVIDIA H100 SXM" },
      { label: "Duration", value: "60 seconds" },
      { label: "Region", value: "US East" },
    ],
    title: "GPU burst rental",
    unit: "1 GPU · 60-second lease",
  },
};

function getX402ClientSnippet(workload: X402WorkloadId) {
  return `const paidFetch = wrapFetchWithPayment(fetch, client)

const response = await paidFetch("/api/x402/compute", {
  method: "POST",
  body: JSON.stringify({ workload: "${workload}" })
})

// request → 402 quote → pay → retry → compute`;
}

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
  ACTIVE: "cds-status cds-status-primary",
  AMOUNT_MISMATCH: "cds-status cds-status-negative",
  AWAITING_PAYMENT: "cds-status cds-status-primary",
  COMPLETED: "cds-status cds-status-positive",
  CREATED: "cds-status cds-status-primary",
  CONVERSION_FAILED: "cds-status cds-status-negative",
  CONVERSION_FILLED: "cds-status cds-status-positive",
  CONVERSION_SUBMITTED: "cds-status cds-status-primary",
  DEACTIVATED: "cds-status cds-status-neutral",
  EXPIRED: "cds-status cds-status-warning",
  FAILED: "cds-status cds-status-negative",
  LATE_PAYMENT: "cds-status cds-status-warning",
  PAID: "cds-status cds-status-positive",
  PARTIAL: "cds-status cds-status-warning",
  PAYMENT_SUBMITTED: "cds-status cds-status-primary",
  PROCESSING: "cds-status cds-status-primary",
  UNSUPPORTED: "cds-status cds-status-neutral",
};

function formatAmount(value: number | string, currencyLabel = "USDC") {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return `${parsed.toFixed(2)} ${currencyLabel}`;
}

function resolveCreditAmount(
  preset: CreditAmountPreset,
  customAmount: string,
) {
  const rawAmount = preset === "other" ? customAmount.trim() : preset;

  if (!rawAmount) {
    return null;
  }

  const parsedAmount = Number(rawAmount);
  const amountInCents = Math.round(parsedAmount * 100);

  if (
    !Number.isFinite(parsedAmount) ||
    parsedAmount < 0.01 ||
    parsedAmount > 10_000 ||
    Math.abs(parsedAmount * 100 - amountInCents) > 0.000001
  ) {
    return null;
  }

  return amountInCents / 100;
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
  return statusStyles[status.toUpperCase()] ?? "cds-status cds-status-neutral";
}

function formatAttemptStage(stage: AgentCheckoutPaymentAttempt["stage"]) {
  return formatStatusLabel(stage);
}

function getAttemptStageStyle(stage: AgentCheckoutPaymentAttempt["stage"]) {
  switch (stage) {
    case "completed":
      return "cds-status cds-status-positive";
    case "failed":
      return "cds-status cds-status-negative";
    case "submitted":
      return "cds-status cds-status-primary";
    case "signed":
      return "cds-status cds-status-primary";
    case "payload_resolved":
      return "cds-status cds-status-warning";
    default:
      return "cds-status cds-status-neutral";
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

  throw new Error("Unable to calculate enough Base ETH to cover this checkout.");
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
      "error" in data ? data.error : "Unable to refresh the direct transfer.";
    throw new Error(message ?? "Unable to refresh the direct transfer.");
  }

  return data.charge;
}

async function syncAgentCheckoutFromServer(checkoutId: string) {
  const response = await fetch(
    `/api/coinbase/agent-checkouts/${encodeURIComponent(checkoutId)}/sync`,
    {
      method: "POST",
    },
  );
  const data = (await response.json()) as
    | AgentCheckoutResponse
    | CreateCheckoutErrorResponse;

  if (!response.ok || !("checkout" in data)) {
    const message =
      "error" in data ? data.error : "Unable to sync the agent checkout.";
    throw new Error(message ?? "Unable to sync the agent checkout.");
  }

  return data.checkout;
}

function buildCheckoutMetadata(
  flow: DemoFlow,
  customMetadata: Record<string, string>,
  automaticMetadata: Record<string, string> = {},
  amount = TEST_CART.unitAmount,
) {
  return {
    amount: amount.toFixed(2),
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
        className="cds-button cds-button-secondary cds-button-compact"
        onClick={onBack}
        type="button"
      >
        <CdsIcon name="arrowLeft" size={16} />
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
      className="inline-flex items-center gap-2 break-all text-[var(--accent-strong)] underline-offset-4 hover:underline"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {value}
      <CdsIcon name="externalLink" size={12} />
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
    <div className="cds-elevation-card rounded-[1.5rem] px-4 py-4">
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

function X402ProtocolPanel({
  exchanges,
  result,
  stage,
  workload,
}: {
  exchanges: X402Exchange[];
  result: X402ComputeResponse | null;
  stage: X402DemoStage;
  workload: X402WorkloadId;
}) {
  const workloadConfig = X402_WORKLOADS[workload];
  const stageLabel =
    stage === "complete"
      ? workload === "inference"
        ? "Completion delivered"
        : "Capacity reserved"
      : stage === "error"
        ? "Demo interrupted"
        : stage === "idle"
          ? "Ready"
          : "Handshake running";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Live protocol trace</p>
          <h3 className="display-font mt-2 text-2xl font-semibold tracking-[-0.04em]">
            Request. Pay. Compute.
          </h3>
        </div>
        <span className="cds-status cds-status-neutral">
          {stageLabel}
        </span>
      </div>

      <div className="protocol-log" aria-live="polite">
        {exchanges.length === 0 ? (
          <div className="protocol-log-empty">
            Run {workloadConfig.title.toLowerCase()} to watch the client receive
            an exact USDC quote, attach payment proof, and unlock the compute
            response.
          </div>
        ) : (
          exchanges.map((exchange, index) => (
            <div className="protocol-log-row" key={`${exchange.status}-${index}`}>
              <span className="protocol-log-status">{exchange.status}</span>
              <div>
                <p className="font-semibold text-[var(--foreground)]">
                  {exchange.label}
                </p>
                <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                  {exchange.detail}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {result ? (
        <div className="x402-compute-result" aria-live="polite">
          <div className="x402-compute-result-head">
            <div>
              <p className="eyebrow">
                {result.workload === "inference" ? "Completion" : "Compute lease"}
              </p>
              <h4>
                {result.workload === "inference"
                  ? "Inference returned"
                  : "H100 capacity ready"}
              </h4>
            </div>
            <span className="cds-status cds-status-positive">Delivered</span>
          </div>

          {result.workload === "inference" ? (
            <>
              <p className="x402-inference-output">{result.result.output}</p>
              <div className="x402-result-metrics">
                <span>{result.result.model}</span>
                <span>{result.result.inputTokens} input tokens</span>
                <span>{result.result.outputTokens} output tokens</span>
                <span>{result.result.latencyMs}ms</span>
              </div>
            </>
          ) : (
            <div className="x402-lease-grid">
              <div>
                <span>Lease ID</span>
                <strong>{result.result.leaseId}</strong>
              </div>
              <div>
                <span>Accelerator</span>
                <strong>{result.result.accelerator}</strong>
              </div>
              <div>
                <span>Window</span>
                <strong>{result.result.durationSeconds} seconds</strong>
              </div>
              <div>
                <span>Region</span>
                <strong>{result.result.region}</strong>
              </div>
            </div>
          )}
        </div>
      ) : null}

      <p className="text-xs leading-5 text-[var(--ink-soft)]">
        Protocol simulator: the endpoint returns a real HTTP 402 challenge and
        x402 headers. Demo proof is accepted; no wallet signs and no funds move.
      </p>
    </div>
  );
}

function AgentChatPanel({
  checkout,
  input,
  isRunning,
  messages,
  onInputChange,
  onPayCurrentCheckout,
  onSubmit,
}: {
  checkout: AgentCheckoutPublicView | null;
  input: string;
  isRunning: boolean;
  messages: AgentChatMessage[];
  onInputChange: (value: string) => void;
  onPayCurrentCheckout: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div className="mt-6 rounded-[1.5rem] border border-[var(--line)] bg-[#f7f9ff] px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Agent Chat</p>
          <h3 className="display-font mt-2 text-2xl font-semibold tracking-[-0.03em]">
            Coinbiz payment agent
          </h3>
        </div>
        {checkout ? (
          <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${getStatusStyle(checkout.status)}`}>
            {formatStatusLabel(checkout.status)}
          </span>
        ) : null}
      </div>

      <div className="mt-4 min-h-32 space-y-3 rounded-[1.25rem] border border-[var(--line)] bg-white/78 p-3">
        {messages.length === 0 ? (
          <p className="text-sm leading-7 text-[var(--ink-soft)]">
            Paste a Coinbiz agent-checkout link here. The agent will reject arbitrary store links and only pay signed Base USDC requests under policy.
          </p>
        ) : (
          messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`rounded-[1rem] px-3 py-2 text-sm leading-6 ${
                message.role === "agent"
                  ? "bg-[#eef4ff] text-[var(--foreground)]"
                  : "bg-white text-[var(--ink-soft)]"
              }`}
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                {message.role === "agent" ? "Agent" : "You"}
              </p>
              <p className="mt-1 break-all">{message.content}</p>
            </div>
          ))
        )}
      </div>

      <form className="mt-4 space-y-3" onSubmit={onSubmit}>
        <textarea
          className="cds-control min-h-24 w-full rounded-[1.25rem] text-sm leading-6"
          onChange={(event) => onInputChange(event.target.value)}
          placeholder="Paste a Coinbiz agent-checkout link or ask the agent to pay it."
          value={input}
        />
        <div className="flex flex-wrap gap-3">
          <button
            className="cds-button cds-button-primary"
            disabled={isRunning || !input.trim()}
            type="submit"
          >
            {isRunning ? "Thinking..." : "Send"}
          </button>
          {checkout ? (
            <button
              className="cds-button cds-button-secondary"
              disabled={isRunning || checkout.status === "paid"}
              onClick={onPayCurrentCheckout}
              type="button"
            >
              Ask agent to pay
            </button>
          ) : null}
        </div>
      </form>
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
    <div className="metadata-editor mt-6 space-y-3">
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
          className="metadata-add-action cds-button cds-button-secondary cds-button-compact"
          onClick={onAdd}
          type="button"
        >
          <CdsIcon name="add" size={16} />
          Add field
        </button>
      </div>

      <div className="space-y-3">
        {fields.map((field, index) => (
          <div
            key={field.id}
            className="metadata-row grid gap-3 md:grid-cols-[0.9fr_1.1fr_auto]"
          >
            <label className="block space-y-2">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                Field
              </span>
              <input
                className="metadata-input"
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
                className="metadata-input"
                onChange={(event) =>
                  onUpdate(field.id, "value", event.target.value)
                }
                placeholder={index === 0 ? "123" : "spring"}
                value={field.value}
              />
            </label>
            <button
              className="metadata-remove-action cds-button cds-button-negative cds-button-compact self-end"
              disabled={fields.length === 1}
              onClick={() => onRemove(field.id)}
              type="button"
            >
              <CdsIcon name="trashCan" size={16} />
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
    <div className="embedded-funding">
      <div className="wallet-balance-line">
        <span>Available</span>
        <strong>{formatCompactCryptoAmount(balances.usdc, "USDC")}</strong>
        <span>·</span>
        <strong>{formatCompactCryptoAmount(balances.eth, "ETH")}</strong>
        <button
          aria-label="Refresh wallet balances"
          disabled={!isReady || balances.status === "loading"}
          onClick={onRefreshBalances}
          type="button"
        >
          <CdsIcon name="refresh" size={12} />
          {balances.status === "loading" ? "Refreshing" : "Refresh"}
        </button>
      </div>

      <div className="funding-switch" aria-label="Wallet funding asset">
        {(["USDC", "ETH"] as EmbeddedFundingAsset[]).map((asset) => (
          <button
            aria-pressed={fundingAsset === asset}
            className={fundingAsset === asset ? "is-active" : ""}
            key={asset}
            onClick={() => onFundingAssetChange(asset)}
            type="button"
          >
            {asset === "ETH" ? "Pay with ETH" : "Pay with USDC"}
          </button>
        ))}
      </div>

      {fundingAsset === "ETH" ? (
        <p className="funding-quote">
          {quote.status === "loading"
            ? "Quoting an ETH → USDC swap…"
            : `${formatCompactCryptoAmount(quote.fromAmountEth, "ETH")} converts to approximately ${formatCompactCryptoAmount(quote.expectedUsdc, "USDC")} · fee ${formatNetworkFeeEth(quote.networkFeeEth)}`}
        </p>
      ) : null}

      {balances.error || quote.error || (quote.status === "success" && !quoteCoversPayment) ? (
        <p className="funding-error">
          {balances.error ?? quote.error ?? "The swap quote does not cover this payment yet."}
        </p>
      ) : null}

      {paymentPhase ? <p className="funding-phase">{paymentPhase}</p> : null}

      {swapReceipt ? (
        <details className="advanced-fields">
          <summary>Swap receipt</summary>
          <ReceiptField label="Status" value={formatStatusLabel(swapReceipt.status)} />
          <ReceiptField label="Transaction" mono href={swapTxUrl} value={swapReceipt.transactionHash ?? "Pending"} />
        </details>
      ) : null}
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
  const [creditAmount, setCreditAmount] = useState<number | null>(null);
  const [creditAmountModalOpen, setCreditAmountModalOpen] = useState(false);
  const [creditAmountPreset, setCreditAmountPreset] =
    useState<CreditAmountPreset>("1");
  const [customCreditAmount, setCustomCreditAmount] = useState("");
  const [creditAmountError, setCreditAmountError] = useState<string | null>(null);
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
  const [agentCheckout, setAgentCheckout] =
    useState<AgentCheckoutPublicView | null>(null);
  const [agentChatInput, setAgentChatInput] = useState("");
  const [agentChatMessages, setAgentChatMessages] = useState<AgentChatMessage[]>([]);
  const [agentChatRunning, setAgentChatRunning] = useState(false);
  const [agentCreating, setAgentCreating] = useState(false);
  const [x402Stage, setX402Stage] = useState<X402DemoStage>("idle");
  const [x402Exchanges, setX402Exchanges] = useState<X402Exchange[]>([]);
  const [x402Workload, setX402Workload] =
    useState<X402WorkloadId>("inference");
  const [x402Result, setX402Result] =
    useState<X402ComputeResponse | null>(null);
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

  const selectedCreditAmount = resolveCreditAmount(
    creditAmountPreset,
    customCreditAmount,
  );
  const isCreditFlow = selectedFlow === "hosted" || selectedFlow === "embedded";
  const totalAmount = isCreditFlow
    ? (creditAmount ?? TEST_CART.unitAmount)
    : TEST_CART.unitAmount;
  const activeX402Workload = X402_WORKLOADS[x402Workload];
  const totalAmountAtomicUsdc = decimalToAtomicUnits(
    totalAmount.toFixed(2),
    USDC_DECIMALS,
  );
  const embeddedWalletReady =
    embeddedWalletSession.isInitialized &&
    embeddedWalletSession.isSignedIn &&
    Boolean(embeddedWalletSession.evmAddress);
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
  const pushPaymentUri = pushCharge ? buildPushPaymentUri(pushCharge) : null;

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

  useEffect(() => {
    setWizardStep("intro");
    setSelectedFlow(null);
    setEnvironment("sandbox");
  }, []);

  useEffect(() => {
    if (!creditAmountModalOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !checkoutCreating) {
        setCreditAmountModalOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [checkoutCreating, creditAmountModalOpen]);

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
              : "Unable to refresh the direct transfer.",
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

  useEffect(() => {
    if (
      !agentCheckout ||
      agentCheckout.status === "paid" ||
      agentCheckout.status === "failed" ||
      agentCheckout.status === "expired" ||
      agentCheckout.status === "amount_mismatch"
    ) {
      return;
    }

    const checkoutId = agentCheckout.id;
    let cancelled = false;

    async function syncAgentCheckout() {
      try {
        const nextCheckout = await syncAgentCheckoutFromServer(checkoutId);

        if (!cancelled) {
          setAgentCheckout(nextCheckout);
        }
      } catch (error) {
        if (!cancelled) {
          setCheckoutErrorMessage(
            error instanceof Error
              ? error.message
              : "Unable to sync agent checkout.",
          );
        }
      }
    }

    const intervalId = window.setInterval(() => {
      void syncAgentCheckout();
    }, 6000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [agentCheckout]);

  function prepareMetadata(
    flow: DemoFlow,
    automaticMetadata: Record<string, string> = {},
    amount = TEST_CART.unitAmount,
  ) {
    const customMetadata = buildCustomMetadata(metadataFields);
    const metadata = buildCheckoutMetadata(
      flow,
      customMetadata,
      automaticMetadata,
      amount,
    );
    setSubmittedMetadata(metadata);

    return {
      customMetadata,
      metadata,
    };
  }

  async function createOfficialCheckoutForFlow(
    flow: DemoFlow,
    amount = TEST_CART.unitAmount,
    automaticMetadata: Record<string, string> = {},
  ) {
    const { metadata } = prepareMetadata(flow, automaticMetadata, amount);
    const response = await fetch("/api/coinbase/checkouts", {
      body: JSON.stringify({
        amount: amount.toFixed(2),
        description:
          flow === "hosted" || flow === "embedded"
            ? `CoinBiz credits · ${formatAmount(amount)}`
            : `${flowLabels[flow]} · $0.01 test payment`,
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

  async function handleCreateHostedCheckout(amount = totalAmount) {
    try {
      setCheckoutCreating(true);
      resetMessages();
      setEmbeddedWalletAttempt(null);
      setHeadlessAttempt(null);
      const checkout = await createOfficialCheckoutForFlow("hosted", amount);
      setTrackedHostedCheckoutId(checkout.id);
    } catch (error) {
      setCheckoutErrorMessage(
        error instanceof Error ? error.message : "Unable to create checkout.",
      );
    } finally {
      setCheckoutCreating(false);
    }
  }

  async function handleCreateEmbeddedCheckout(amount = totalAmount) {
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
      const paymentAmountAtomicUsdc = decimalToAtomicUnits(
        amount.toFixed(2),
        USDC_DECIMALS,
      );
      let embeddedSwapPlan: EmbeddedSwapPlan | null = null;

      if (embeddedFundingAsset === "ETH") {
        setEmbeddedPaymentPhase(
          `Calculating Base ETH needed for ${formatAmount(amount)}...`,
        );
        embeddedSwapPlan = await createEmbeddedEthSwapPlan({
          account: payerAddress,
          targetUsdcAtomic: paymentAmountAtomicUsdc,
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
        amount,
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
            targetUsdcAtomic: paymentAmountAtomicUsdc,
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
          "error" in data ? data.error : "Unable to create the receive address.";
        throw new Error(errorMessage ?? "Unable to create the receive address.");
      }

      setPushCharge(data.charge);
      setPushToken(data.token);
    } catch (error) {
      setPushErrorMessage(
        error instanceof Error ? error.message : "Unable to create the receive address.",
      );
    } finally {
      setPushCreating(false);
    }
  }

  function updateAgentCheckoutFromToolResults(
    toolResults: AgentChatResponse["toolResults"],
  ) {
    if (!toolResults) {
      return;
    }

    for (const toolResult of toolResults) {
      const result = toolResult.result as Partial<AgentCheckoutPublicView> | null;

      if (
        result &&
        typeof result === "object" &&
        typeof result.id === "string" &&
        typeof result.amountUsdc === "string" &&
        typeof result.status === "string"
      ) {
        setAgentCheckout(result as AgentCheckoutPublicView);
      }
    }
  }

  async function submitAgentChatMessage(message: string, autoPay = false) {
    if (!message.trim()) {
      return;
    }

    try {
      setAgentChatRunning(true);
      resetMessages();
      setAgentChatMessages((currentMessages) => [
        ...currentMessages,
        {
          content: message.trim(),
          role: "tool",
          toolName: "inspect_coinbiz_checkout_link",
        },
      ]);

      const response = await fetch("/api/coinbase/agent-chat", {
        body: JSON.stringify({
          autoPay,
          message,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const data = (await response.json()) as AgentChatResponse;

      if (!response.ok) {
        throw new Error(data.error || "Unable to run agent chat.");
      }

      updateAgentCheckoutFromToolResults(data.toolResults);
      setAgentChatMessages((currentMessages) => [
        ...currentMessages,
        ...(data.messages ?? []),
      ]);
      setAgentChatInput("");
    } catch (error) {
      setCheckoutErrorMessage(
        error instanceof Error ? error.message : "Unable to run agent chat.",
      );
    } finally {
      setAgentChatRunning(false);
    }
  }

  async function handleCreateAgentCheckout() {
    if (environment !== "live") {
      setCheckoutErrorMessage("Agent flow is live-only.");
      return;
    }

    try {
      setAgentCreating(true);
      resetMessages();

      const { metadata } = prepareMetadata("agent", {
        agentPolicy: "autonomous-under-cap",
        fundingAsset: "USDC",
        fundingNetwork: "base",
      });
      const response = await fetch("/api/coinbase/agent-checkouts", {
        body: JSON.stringify({
          amountUsdc: totalAmount.toFixed(2),
          description: "Agent checkout · $0.01 test payment",
          metadata,
          reference: metadata.reference,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const data = (await response.json()) as
        | CreateAgentCheckoutResponse
        | CreateCheckoutErrorResponse;

      if (!response.ok || !("checkout" in data)) {
        const errorMessage =
          "error" in data ? data.error : "Unable to create agent checkout.";
        throw new Error(errorMessage ?? "Unable to create agent checkout.");
      }

      setAgentCheckout(data.checkout);
      setAgentChatMessages([
        {
          content: `Created agent checkout ${data.checkout.checkoutUrl}`,
          role: "agent",
        },
      ]);
      setAgentChatInput(`Pay ${data.checkout.checkoutUrl}`);
    } catch (error) {
      setCheckoutErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to create agent checkout.",
      );
    } finally {
      setAgentCreating(false);
    }
  }

  async function handleRunX402Demo() {
    const workload = X402_WORKLOADS[x402Workload];
    const requestBody = JSON.stringify({ workload: x402Workload });

    try {
      resetMessages();
      setX402Result(null);
      setX402Stage("requesting");
      setX402Exchanges([
        {
          detail: `The client requests ${workload.unit.toLowerCase()} with an ordinary HTTP call.`,
          label: `POST /api/x402/compute · ${workload.title}`,
          status: "POST",
        },
      ]);

      const challengeResponse = await fetch("/api/x402/compute", {
        body: requestBody,
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const paymentRequired = challengeResponse.headers.get("payment-required");

      if (challengeResponse.status !== 402 || !paymentRequired) {
        throw new Error("The demo endpoint did not return an x402 challenge.");
      }

      setX402Stage("payment_required");
      setX402Exchanges((currentExchanges) => [
        ...currentExchanges,
        {
          detail: `The server quotes exactly ${workload.priceUsdc} USDC on Base Sepolia for this compute unit.`,
          label: "PAYMENT-REQUIRED · exact price and recipient",
          status: "402",
        },
      ]);

      await new Promise((resolve) => window.setTimeout(resolve, 450));
      setX402Stage("settling");
      setX402Exchanges((currentExchanges) => [
        ...currentExchanges,
        {
          detail: `The x402 client authorizes ${workload.priceUsdc} USDC and retries the same request with payment proof.`,
          label: "PAYMENT-SIGNATURE attached · automatic retry",
          status: "PAY",
        },
      ]);

      const paidResponse = await fetch("/api/x402/compute", {
        body: requestBody,
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "PAYMENT-SIGNATURE": "coinbiz-demo-signature",
        },
        method: "POST",
      });
      const paymentResponse = paidResponse.headers.get("payment-response");

      if (!paidResponse.ok || !paymentResponse) {
        throw new Error("The demo payment could not be settled.");
      }

      const computeResponse = (await paidResponse.json()) as X402ComputeResponse;

      if (computeResponse.workload !== x402Workload) {
        throw new Error("The compute response did not match the requested workload.");
      }

      setX402Result(computeResponse);
      setX402Stage("complete");
      setX402Exchanges((currentExchanges) => [
        ...currentExchanges,
        {
          detail:
            computeResponse.workload === "inference"
              ? `The completion returns in ${computeResponse.result.latencyMs}ms with settlement details in PAYMENT-RESPONSE.`
              : `Lease ${computeResponse.result.leaseId} is ready for a ${computeResponse.result.durationSeconds}-second H100 window.`,
          label:
            computeResponse.workload === "inference"
              ? "Inference response delivered"
              : "GPU capacity reserved",
          status: "200",
        },
      ]);
    } catch (error) {
      setX402Result(null);
      setX402Stage("error");
      setCheckoutErrorMessage(
        error instanceof Error ? error.message : "Unable to run the x402 demo.",
      );
    }
  }

  function handleBack() {
    setCreditAmountModalOpen(false);

    if (wizardStep === "experience") {
      setWizardStep("intro");
      window.scrollTo({ behavior: "auto", top: 0 });
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

  function handleSelectEnvironment(nextEnvironment: CheckoutEnvironment) {
    resetMessages();
    setEnvironment(nextEnvironment);

    if (wizardStep === "experience" && selectedFlow) {
      return;
    }

    setSelectedFlow(null);
    setWizardStep("flow");
  }

  function isFlowAvailable(
    flow: DemoFlow,
    candidateEnvironment: CheckoutEnvironment = environment,
  ) {
    return (
      candidateEnvironment === "live" || flow === "hosted" || flow === "x402"
    );
  }

  function handleSelectFlow(flow: DemoFlow) {
    resetMessages();
    setCreditAmountModalOpen(false);
    if (!isFlowAvailable(flow)) {
      setEnvironment("live");
    }
    setSelectedFlow(flow);
    setWizardStep("experience");
    window.scrollTo({ behavior: "auto", top: 0 });
  }

  function openCreditAmountModal() {
    resetMessages();
    setCreditAmountError(null);

    if (creditAmount !== null) {
      const matchingPreset = CREDIT_AMOUNT_PRESETS.find(
        (option) =>
          option.value !== "other" && Number(option.value) === creditAmount,
      );

      if (matchingPreset) {
        setCreditAmountPreset(matchingPreset.value);
      } else {
        setCreditAmountPreset("other");
        setCustomCreditAmount(creditAmount.toFixed(2));
      }
    }

    setCreditAmountModalOpen(true);
  }

  async function handleCreditAmountSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (selectedFlow !== "hosted" && selectedFlow !== "embedded") {
      return;
    }

    if (selectedCreditAmount === null) {
      setCreditAmountError(
        "Enter an amount from $0.01 to $10,000, using no more than two decimals.",
      );
      return;
    }

    const flow = selectedFlow;
    setCreditAmount(selectedCreditAmount);
    setCreditAmountError(null);
    setCreditAmountModalOpen(false);

    if (flow === "hosted") {
      await handleCreateHostedCheckout(selectedCreditAmount);
      return;
    }

    await handleCreateEmbeddedCheckout(selectedCreditAmount);
  }

  function handleSelectX402Workload(workload: X402WorkloadId) {
    if (isX402DemoRunning(x402Stage)) {
      return;
    }

    resetMessages();
    setX402Workload(workload);
    setX402Stage("idle");
    setX402Exchanges([]);
    setX402Result(null);
  }

  async function handleSelectedFlowAction() {
    if (!selectedFlow) {
      return;
    }

    if (selectedFlow === "hosted") {
      openCreditAmountModal();
      return;
    }

    if (selectedFlow === "embedded") {
      openCreditAmountModal();
      return;
    }

    if (selectedFlow === "headless") {
      await handleCreateHeadlessCheckout();
      return;
    }

    if (selectedFlow === "agent") {
      await handleCreateAgentCheckout();
      return;
    }

    if (selectedFlow === "x402") {
      await handleRunX402Demo();
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
    (!demoState.credentialsConfigured && selectedFlow !== "x402") ||
    checkoutCreating ||
    headlessCreating ||
    agentCreating ||
    agentChatRunning ||
    pushCreating ||
    (selectedFlow === "embedded" && !embeddedWalletReady);
  const selectedActionDisabled =
    actionDisabled ||
    (selectedFlow === "x402" && isX402DemoRunning(x402Stage));
  const selectedActionLoading =
    checkoutCreating ||
    headlessCreating ||
    agentCreating ||
    agentChatRunning ||
    pushCreating ||
    isX402DemoRunning(x402Stage);

  const actionLabel =
    selectedFlow === "hosted"
      ? checkoutCreating
        ? "Creating..."
        : "Buy credits"
      : selectedFlow === "embedded"
        ? checkoutCreating
          ? embeddedFundingAsset === "ETH"
            ? "Swapping & paying..."
            : "Submitting..."
          : embeddedWalletReady
            ? "Buy credits"
            : "Sign in to buy credits"
        : selectedFlow === "x402"
          ? isX402DemoRunning(x402Stage)
            ? "Purchasing compute..."
            : x402Stage === "complete"
              ? `${activeX402Workload.actionLabel} again`
              : activeX402Workload.actionLabel
        : selectedFlow === "headless"
          ? headlessCreating
            ? "Submitting..."
            : "Submit headless payment"
          : selectedFlow === "agent"
            ? agentCreating
              ? "Creating..."
              : "Create agent checkout"
          : pushCreating
            ? "Generating..."
            : "Create receive address";
  const hasLiveOutput =
    (selectedFlow === "hosted" && Boolean(selectedCheckout)) ||
    (selectedFlow === "embedded" && Boolean(selectedAttempt)) ||
    (selectedFlow === "x402" && x402Exchanges.length > 0) ||
    (selectedFlow === "push" && Boolean(pushCharge)) ||
    (selectedFlow === "headless" && Boolean(selectedAttempt)) ||
    (selectedFlow === "agent" && Boolean(agentCheckout));
  const receiptCard = hasLiveOutput ? renderReceiptCard() : null;

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

          <div className="receipt-core">
            <ReceiptField label="Amount" value={formatAmount(selectedCheckout.amount)} />
            <ReceiptField
              href={selectedCheckout.url}
              label="Payment URL"
              mono
              value={selectedCheckout.url}
            />
          </div>

          {!isCompleted ? (
            <button
              className="cds-button cds-button-primary"
              onClick={() =>
                window.open(selectedCheckout.url, "_blank", "noopener,noreferrer")
              }
              type="button"
            >
              Open hosted checkout
              <CdsIcon name="externalLink" size={16} />
            </button>
          ) : null}

          <details className="advanced-fields">
            <summary>Checkout details</summary>
            <ReceiptField label="Reference" value={getReference(receiptMetadata)} />
            <ReceiptField label="Checkout ID" mono value={selectedCheckout.id} />
            <ReceiptField label="Network" value={formatStatusLabel(selectedCheckout.network)} />
            <ReceiptField label="Transaction" mono href={txUrl} value={selectedCheckout.transactionHash ?? "Pending"} />
            <MetadataPreview metadata={receiptMetadata} />
          </details>
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

          <div className="receipt-core">
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
            <div className="cds-feedback cds-feedback-negative">
              {selectedAttempt.errorMessage}
            </div>
          ) : null}

          <MetadataPreview metadata={receiptMetadata} />
        </div>
      );
    }

    if (selectedFlow === "x402") {
      return (
        <X402ProtocolPanel
          exchanges={x402Exchanges}
          result={x402Result}
          stage={x402Stage}
          workload={x402Workload}
        />
      );
    }

    if (selectedFlow === "push") {
      if (!pushCharge) {
        return (
          <p className="text-sm leading-7 text-[var(--ink-soft)]">
            Create a receive address and its payment details will appear here.
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

          <div className="receipt-core">
            <ReceiptField
              label="Send exactly"
              value={`${pushCharge.quotedAmount} ${pushCharge.asset}`}
            />
            <ReceiptField label="Address" mono value={pushCharge.address} />
            <ReceiptField
              label="Payment URI"
              mono
              value={pushPaymentUri ?? pushCharge.address}
            />
          </div>

          <details className="advanced-fields">
            <summary>Transfer details</summary>
            <ReceiptField label="USD amount" value={formatAmount(pushCharge.amountUsd, "USD")} />
            <ReceiptField label="Network" value={formatStatusLabel(pushCharge.network)} />
            <ReceiptField label="Received" value={`${pushCharge.payment.totalReceivedAmount} ${pushCharge.asset}`} />
            <ReceiptField href={latestTransactionUrl} label="Latest transaction" mono value={pushCharge.payment.latestTransactionHash ?? "Pending"} />
            <ReceiptField label="Expires" value={formatTimestamp(pushCharge.payment.expiresAt)} />
            <MetadataPreview metadata={receiptMetadata} />
          </details>
        </div>
      );
    }

    if (selectedFlow === "agent") {
      if (!agentCheckout) {
        return (
          <p className="text-sm leading-7 text-[var(--ink-soft)]">
            Create an agent checkout and the signed request will appear here.
          </p>
        );
      }

      const txUrl = agentCheckout.txHash
        ? getNetworkExplorerUrl(agentCheckout.chain, agentCheckout.txHash)
        : undefined;

      return (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Receipt</p>
              <h3 className="display-font mt-2 text-2xl font-semibold tracking-[-0.03em]">
                {agentCheckout.status === "paid"
                  ? "Payment received"
                  : agentCheckout.status === "payment_submitted"
                    ? "Payment submitted"
                    : "Agent checkout created"}
              </h3>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${getStatusStyle(
                agentCheckout.status,
              )}`}
            >
              {formatStatusLabel(agentCheckout.status)}
            </span>
          </div>

          <div className="receipt-core">
            <ReceiptField label="Amount" value={formatAmount(agentCheckout.amountUsdc)} />
            <ReceiptField label="Reference" value={agentCheckout.reference} />
            <ReceiptField label="Checkout ID" mono value={agentCheckout.id} />
            <ReceiptField
              href={agentCheckout.checkoutUrl}
              label="Agent link"
              mono
              value={agentCheckout.checkoutUrl}
            />
            <ReceiptField
              label="Recipient"
              mono
              value={agentCheckout.recipientAddress}
            />
            <ReceiptField label="Network" value={formatStatusLabel(agentCheckout.chain)} />
            <ReceiptField
              label="Wallet provider"
              value={agentCheckout.walletProvider ?? "Pending"}
            />
            <ReceiptField
              href={txUrl}
              label="Transaction hash"
              mono
              value={agentCheckout.txHash ?? "Pending"}
            />
            <ReceiptField
              label="Signature"
              mono
              value={agentCheckout.paymentRequestSignature}
            />
            <ReceiptField
              label="Expires"
              value={formatTimestamp(agentCheckout.expiresAt)}
            />
          </div>

          {agentCheckout.errorMessage ? (
            <div className="cds-feedback cds-feedback-negative">
              {agentCheckout.errorMessage}
            </div>
          ) : null}

          <MetadataPreview metadata={agentCheckout.metadata} />
        </div>
      );
    }

    return null;
  }

  return (
    <main className="coinbiz-shell min-h-screen">
      {wizardStep === "intro" ? (
        <div className="future-home">
          <header className="future-nav">
            <a className="brand-lockup" href="#top" aria-label="CoinBiz home">
              <Image
                alt=""
                className="brand-logo"
                fetchPriority="high"
                height={64}
                src="/coinbiz_logo.png"
                width={310}
              />
            </a>
          </header>

          <section className="future-hero" id="top">
            <DisintegrationField />
            <div className="future-hero-copy">
              <h1 className="future-title">
                <span aria-hidden="true">
                  <span className="signal-sweep-text">Payments</span>
                  <AnimatedLetterWave text=", for every" />
                  <br />
                  <AnimatedLetterWave startIndex={11} text="way value moves." />
                </span>
                <span className="sr-only">
                  Payments, for every way value moves.
                </span>
              </h1>
              <p className="future-description">
                Stablecoin payments for people and agents across AI
                infrastructure and digital services—from inference and LLM
                gateways to GPU compute and paid APIs. Powered by Coinbase
                Business.
              </p>
            </div>

            <div className="future-mode-dock" id="modes" aria-label="Payment modes">
              {publicDemoFlows.map((flow) => (
                <button
                  className="future-mode"
                  key={flow.value}
                  onClick={() => handleSelectFlow(flow.value)}
                  type="button"
                >
                  <span className="future-mode-index">
                    <CdsIcon
                      active
                      name={publicModeIcons[flow.value]}
                      size={24}
                    />
                  </span>
                  <span className="future-mode-copy">
                    <strong>{flowLabels[flow.value]}</strong>
                    <small>{flow.eyebrow}</small>
                  </span>
                  <CdsIcon
                    className="future-mode-arrow"
                    name="forwardArrow"
                    size={16}
                  />
                </button>
              ))}
            </div>
          </section>
        </div>
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
                      ? "Use live mode for embedded checkout and direct transfers."
                      : "Use sandbox for hosted checkout and the x402 protocol simulator."}
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
                  description: "Run an HTTP-native 402 payment handshake for a protected API.",
                  value: "x402",
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
        <section className="demo-workspace">
          <DisintegrationField />
          <header className="workspace-header">
            <button className="workspace-back" onClick={handleBack} type="button">
              <CdsIcon name="arrowLeft" size={16} /> Overview
            </button>
            {selectedFlow === "x402" ? (
              <div className="workspace-simulation-badge" aria-label="No funds mode">
                <span aria-hidden="true" /> No funds
              </div>
            ) : (
              <div className="workspace-environment" aria-label="Environment">
                {(["sandbox", "live"] as CheckoutEnvironment[]).map((value) => {
                  const available = isFlowAvailable(selectedFlow, value);

                  return (
                    <button
                      aria-pressed={environment === value}
                      className={environment === value ? "is-active" : ""}
                      disabled={!available}
                      key={value}
                      onClick={() => handleSelectEnvironment(value)}
                      type="button"
                    >
                      {environmentLabels[value]}
                    </button>
                  );
                })}
              </div>
            )}
          </header>

          <div className="workspace-mode-nav" aria-label="Payment modes">
            {publicDemoFlows.map((flow) => (
              <button
                aria-pressed={selectedFlow === flow.value}
                className={selectedFlow === flow.value ? "is-active" : ""}
                key={flow.value}
                onClick={() => handleSelectFlow(flow.value)}
                type="button"
              >
                <span className="workspace-mode-index">
                  <CdsIcon
                    active={selectedFlow === flow.value}
                    name={publicModeIcons[flow.value]}
                    size={24}
                  />
                </span>
                <span className="workspace-mode-copy">
                  <strong>{flowLabels[flow.value]}</strong>
                  <small>{flow.eyebrow}</small>
                </span>
                <CdsIcon
                  className="workspace-mode-arrow"
                  name="forwardArrow"
                  size={16}
                />
              </button>
            ))}
          </div>

          <div className={`workspace-layout${hasLiveOutput ? " has-output" : ""}`}>
            <div className="workspace-main space-y-5">
              <div className="workspace-card p-6 sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <p className="eyebrow">
                    {selectedFlow === "x402" ? "Machine-priced compute" : "Payment"}
                  </p>
                  <h2 className="display-font text-3xl font-semibold tracking-[-0.04em]">
                    {selectedFlow === "x402"
                      ? "Pay for compute over HTTP"
                      : selectedFlow === "push"
                        ? "Receive a direct transfer"
                        : selectedFlow === "embedded" || selectedFlow === "hosted"
                          ? "Buy credits"
                          : "$0.01 payment"}
                  </h2>
                  <p className="text-sm leading-7 text-[var(--ink-soft)]">
                    {selectedFlow === "hosted"
                      ? "Choose a credit amount, then complete payment on a secure Coinbase-hosted checkout."
                      : selectedFlow === "embedded"
                        ? "Choose a credit amount and pay from a self-custodial wallet without leaving the product."
                        : selectedFlow === "x402"
                          ? "Buy one model response or a short GPU lease. The server quotes the exact price, the client attaches payment proof, and the request retries automatically."
                          : selectedFlow === "agent"
                            ? "Create a signed Base USDC invoice, then chat with the agent to inspect and pay it under policy."
                            : "Create a wallet-native address for a direct BTC or ETH transfer."}
                  </p>
                </div>

                <div className="workspace-context">
                  <span>
                    {selectedFlow === "x402"
                      ? "Simulation"
                      : environmentLabels[environment]}
                  </span>
                  {selectedFlow in publicModeDocs ? (
                    <a
                      href={publicModeDocs[selectedFlow as PublicDemoFlow].href}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {publicModeDocs[selectedFlow as PublicDemoFlow].label}
                      <CdsIcon name="externalLink" size={12} />
                    </a>
                  ) : null}
                </div>
              </div>

              {selectedFlow === "embedded" ? (
                <div className="embedded-wallet-slot">
                  {embeddedWalletConfig.projectId ? (
                    <EmbeddedWalletPanel config={embeddedWalletConfig} variant="compact" />
                  ) : (
                    <p className="text-sm text-[var(--ink-soft)]">
                      Add <span className="font-mono">NEXT_PUBLIC_CDP_PROJECT_ID</span> to enable wallet sign-in.
                    </p>
                  )}
                </div>
              ) : null}

              {selectedFlow === "push" ? (
                <div className="mt-6 flex flex-wrap gap-3">
                  {pushAssetOptions.map((asset) => (
                    <button
                      key={asset}
                      className={`cds-selector ${pushAsset === asset ? "is-active" : ""}`}
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
                          className={`cds-selector ${pushNetwork === option.network ? "is-active" : ""}`}
                          onClick={() => setPushNetwork(option.network)}
                          type="button"
                        >
                          {option.label}
                        </button>
                      ))
                    : null}
                </div>
              ) : null}

              {selectedFlow === "embedded" && embeddedWalletReady ? (
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

              {selectedFlow === "agent" ? (
                <AgentChatPanel
                  checkout={agentCheckout}
                  input={agentChatInput}
                  isRunning={agentChatRunning}
                  messages={agentChatMessages}
                  onInputChange={setAgentChatInput}
                  onPayCurrentCheckout={() => {
                    if (agentCheckout) {
                      void submitAgentChatMessage(
                        `Pay ${agentCheckout.checkoutUrl}`,
                        true,
                      );
                    }
                  }}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitAgentChatMessage(agentChatInput);
                  }}
                />
              ) : null}

              {selectedFlow === "x402" ? (
                <div className="x402-simulator">
                  <div className="x402-workload-heading">
                    <div>
                      <p className="eyebrow">Choose the compute unit</p>
                      <p>
                        Each product exposes the same payment handshake with a
                        different resource, price, and response.
                      </p>
                    </div>
                  </div>

                  <div className="x402-workload-grid" role="group" aria-label="Compute workload">
                    {(Object.entries(X402_WORKLOADS) as Array<
                      [X402WorkloadId, X402WorkloadConfig]
                    >).map(([workloadId, workload]) => (
                      <button
                        aria-pressed={x402Workload === workloadId}
                        className={`x402-workload-option${
                          x402Workload === workloadId ? " is-active" : ""
                        }`}
                        disabled={
                          isX402DemoRunning(x402Stage)
                        }
                        key={workloadId}
                        onClick={() => handleSelectX402Workload(workloadId)}
                        type="button"
                      >
                        <span className="x402-workload-option-top">
                          <span>{workload.eyebrow}</span>
                          <strong>{workload.priceUsdc} USDC</strong>
                        </span>
                        <b>{workload.title}</b>
                        <small>{workload.description}</small>
                      </button>
                    ))}
                  </div>

                  <div className="x402-workload-specs">
                    {activeX402Workload.specs.map((spec) => (
                      <div key={spec.label}>
                        <span>{spec.label}</span>
                        <strong>{spec.value}</strong>
                      </div>
                    ))}
                  </div>

                  <div className="x402-code-card">
                    <div className="x402-code-head">
                      <span>client.ts</span>
                      <span>@x402/fetch</span>
                    </div>
                    <pre>
                      <code>{getX402ClientSnippet(x402Workload)}</code>
                    </pre>
                  </div>
                </div>
              ) : null}

              <div className="payment-line-item">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--foreground)]">
                      {selectedFlow === "x402"
                        ? activeX402Workload.unit
                        : selectedFlow === "hosted" || selectedFlow === "embedded"
                          ? "CoinBiz credits"
                        : TEST_CART.title}
                    </p>
                    {selectedFlow === "x402" ? (
                      <p className="mt-1 font-mono text-xs text-[var(--ink-soft)]">
                        POST /api/x402/compute
                      </p>
                    ) : selectedFlow === "hosted" || selectedFlow === "embedded" ? (
                      <p className="mt-1 text-sm text-[var(--ink-soft)]">
                        Add credits to your demo balance.
                      </p>
                    ) : TEST_CART.caption ? (
                      <p className="mt-1 text-sm text-[var(--ink-soft)]">
                        {TEST_CART.caption}
                      </p>
                    ) : null}
                  </div>
                  <p className="text-lg font-semibold text-[var(--foreground)]">
                    {selectedFlow === "x402"
                      ? `${activeX402Workload.priceUsdc} USDC`
                      : selectedFlow === "hosted" || selectedFlow === "embedded"
                        ? creditAmount === null
                          ? "Choose amount"
                          : formatAmount(creditAmount)
                      : formatAmount(TEST_CART.unitAmount)}
                  </p>
                </div>
              </div>

              {selectedFlow === "x402" ? null : (
                <details className="advanced-fields">
                  <summary>Optional metadata</summary>
                  <MetadataFieldsEditor
                    fields={metadataFields}
                    onAdd={addMetadataField}
                    onRemove={removeMetadataField}
                    onUpdate={updateMetadataField}
                  />
                </details>
              )}

              <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-soft)]">
                    Total
                  </p>
                  <p className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[var(--foreground)]">
                    {selectedFlow === "x402"
                      ? `${activeX402Workload.priceUsdc} USDC`
                      : selectedFlow === "hosted" || selectedFlow === "embedded"
                        ? creditAmount === null
                          ? "Select amount"
                          : formatAmount(creditAmount)
                      : formatAmount(
                          totalAmount,
                          selectedFlow === "push" ? "USD" : "USDC",
                        )}
                  </p>
                </div>

                <button
                  aria-busy={selectedActionLoading}
                  className="cds-button cds-button-primary"
                  disabled={selectedActionDisabled}
                  onClick={() => void handleSelectedFlowAction()}
                  type="button"
                >
                  {actionLabel}
                  <CdsIcon name="forwardArrow" size={16} />
                </button>
              </div>

              {currentErrorMessage ? (
                <div className="cds-feedback cds-feedback-negative mt-5">
                  {currentErrorMessage}
                </div>
              ) : null}
              </div>
            </div>

            {hasLiveOutput ? <aside className="workspace-aside">
              <div className="workspace-aside-label">
                <span>Live output</span>
                <span>{selectedFlowTitle}</span>
              </div>
              {receiptCard ? (
                <div className="workspace-card p-6 sm:p-8">
                {receiptCard}
                </div>
              ) : null}
            </aside> : null}
          </div>
        </section>
      ) : null}

      {creditAmountModalOpen &&
      (selectedFlow === "hosted" || selectedFlow === "embedded") ? (
        <div
          className="credit-modal-backdrop"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !checkoutCreating) {
              setCreditAmountModalOpen(false);
            }
          }}
        >
          <div
            aria-describedby="credit-modal-description"
            aria-labelledby="credit-modal-title"
            aria-modal="true"
            className="credit-modal"
            role="dialog"
          >
            <div className="credit-modal-head">
              <div>
                <p className="eyebrow">
                  {selectedFlow === "hosted"
                    ? "Hosted checkout"
                    : "Embedded checkout"}
                </p>
                <h2 id="credit-modal-title">Buy credits</h2>
                <p id="credit-modal-description">
                  Choose how much to add to your demo balance.
                </p>
              </div>
              <button
                aria-label="Close amount picker"
                className="credit-modal-close"
                disabled={checkoutCreating}
                onClick={() => setCreditAmountModalOpen(false)}
                type="button"
              >
                <CdsIcon name="close" size={16} />
              </button>
            </div>

            <form onSubmit={(event) => void handleCreditAmountSubmit(event)}>
              <div className="credit-amount-grid" role="group" aria-label="Credit amount">
                {CREDIT_AMOUNT_PRESETS.map((option) => (
                  <button
                    aria-pressed={creditAmountPreset === option.value}
                    autoFocus={creditAmountPreset === option.value}
                    className={`${
                      creditAmountPreset === option.value ? "is-active" : ""
                    }${option.value === "other" ? " is-other" : ""}`}
                    key={option.value}
                    onClick={() => {
                      setCreditAmountPreset(option.value);
                      setCreditAmountError(null);
                    }}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              {creditAmountPreset === "other" ? (
                <label className="credit-custom-amount">
                  <span>Custom amount</span>
                  <span className="credit-custom-input">
                    <b aria-hidden="true">$</b>
                    <input
                      aria-invalid={creditAmountError ? "true" : "false"}
                      inputMode="decimal"
                      max="10000"
                      min="0.01"
                      onChange={(event) => {
                        setCustomCreditAmount(event.target.value);
                        setCreditAmountError(null);
                      }}
                      placeholder="25.00"
                      required
                      step="0.01"
                      type="number"
                      value={customCreditAmount}
                    />
                    <em>USDC</em>
                  </span>
                </label>
              ) : null}

              {creditAmountError ? (
                <p className="credit-modal-error" role="alert">
                  {creditAmountError}
                </p>
              ) : (
                <p className="credit-modal-note">
                  {selectedCreditAmount === null
                    ? "Enter a valid credit amount."
                    : `${formatAmount(selectedCreditAmount)} will be charged through ${
                        selectedFlow === "hosted"
                          ? "the hosted checkout"
                          : "your embedded wallet"
                      }.`}
                </p>
              )}

              <div className="credit-modal-actions">
                <button
                  className="cds-button cds-button-secondary"
                  disabled={checkoutCreating}
                  onClick={() => setCreditAmountModalOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="cds-button cds-button-primary"
                  disabled={checkoutCreating}
                  type="submit"
                >
                  {selectedCreditAmount === null
                    ? "Buy credits"
                    : `Buy $${selectedCreditAmount.toFixed(2)} in credits`}
                  <CdsIcon name="forwardArrow" size={16} />
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}
