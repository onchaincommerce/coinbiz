import crypto from "node:crypto";

import { parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { getCheckout } from "@/app/lib/coinbase";
import type { CoinbaseCheckout } from "@/app/lib/coinbase-types";
import type {
  AgentCheckoutPaymentAttempt,
  HeadlessCheckoutResolution,
  HostedPaymentLinkPayload,
  SerializableAuthorizationRequest,
} from "@/app/lib/agentic-payment-types";
import {
  getLatestAgentCheckoutPaymentAttemptByCheckoutId,
  upsertAgentCheckoutPaymentAttempt,
} from "@/app/lib/agentic-payment-store";

const HOSTED_CHECKOUT_ORIGIN = "https://payments.coinbase.com";
const HEADLESS_CHECKOUT_ENABLED = "HEADLESS_CHECKOUT_PAYER_ENABLED";
const HEADLESS_CHECKOUT_MAX_USDC = "HEADLESS_CHECKOUT_PAYER_MAX_USDC";
const HEADLESS_CHECKOUT_PRIVATE_KEY = "HEADLESS_CHECKOUT_PAYER_PRIVATE_KEY";

const BASE_MAINNET_CONFIG = {
  networkId: 8453,
  spendPermissionTokenCollector: "0x8d9F34934dc9619e5DC3Df27D0A40b4A744E7eAa",
  usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  usdcAuthorizationTokenCollector: "0x0E3dF9510de65469C4518D7843919c0b8C7A7757",
  usdcName: "USD Coin",
  usdcVersion: "2",
} as const;

const AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

const COMPLETED_CHECKOUT_STATUSES = new Set(["COMPLETED"]);
const TERMINAL_CHECKOUT_STATUSES = new Set([
  "CANCELED",
  "COMPLETED",
  "EXPIRED",
  "FAILED",
  "REFUNDED",
]);

export type StartAgenticCheckoutPaymentInput = {
  checkoutId?: string;
  checkoutUrl?: string;
  dryRun?: boolean;
  maxPollAttempts?: number;
  payerAddress?: string;
  pollIntervalMs?: number;
  retryFailed?: boolean;
  signature?: string;
  waitForCompletion?: boolean;
};

function normalizeAddress(value: string) {
  return value.trim().toLowerCase();
}

function normalizeAmount(value: string) {
  const amount = Number.parseFloat(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid amount: ${value}`);
  }

  return amount.toFixed(2);
}

function isConfiguredFlagEnabled(name: string) {
  return process.env[name]?.trim().toLowerCase() === "true";
}

function getConfiguredMaxUsdc() {
  const raw = process.env[HEADLESS_CHECKOUT_MAX_USDC]?.trim();
  return raw ? normalizeAmount(raw) : "0.01";
}

function getAgentWalletPrivateKey() {
  const raw = process.env[HEADLESS_CHECKOUT_PRIVATE_KEY]?.trim() ?? "";

  if (!raw) {
    throw new Error(
      `Missing ${HEADLESS_CHECKOUT_PRIVATE_KEY}. Configure the agent payer wallet before submitting payments.`,
    );
  }

  if (!/^0x[a-fA-F0-9]{64}$/.test(raw)) {
    throw new Error(
      `${HEADLESS_CHECKOUT_PRIVATE_KEY} must be a 32-byte hex private key prefixed with 0x.`,
    );
  }

  return raw as `0x${string}`;
}

function extractCheckoutId(input: {
  checkoutId?: string;
  checkoutUrl?: string;
}) {
  if (input.checkoutId?.trim()) {
    return input.checkoutId.trim();
  }

  if (!input.checkoutUrl?.trim()) {
    throw new Error("Provide checkoutId or checkoutUrl.");
  }

  try {
    const url = new URL(input.checkoutUrl);
    const checkoutId = url.pathname.split("/").filter(Boolean).pop();

    if (!checkoutId) {
      throw new Error("Checkout URL did not include a checkout identifier.");
    }

    return checkoutId;
  } catch {
    throw new Error("checkoutUrl must be a valid URL.");
  }
}

function extractHostedPaymentLinkId(checkoutUrl: string) {
  try {
    const url = new URL(checkoutUrl);
    const hostedCheckoutId = url.pathname.split("/").filter(Boolean).pop();

    if (!hostedCheckoutId?.startsWith("pl_")) {
      throw new Error("Hosted checkout URL did not include a payment-link identifier.");
    }

    return hostedCheckoutId;
  } catch {
    throw new Error("checkoutUrl must be a valid Coinbase hosted checkout URL.");
  }
}

function makeAuthorizationRequest(input: {
  amount: string;
  from: string;
  nonce: `0x${string}`;
  tokenCollector: string;
  validBefore: string;
}): SerializableAuthorizationRequest {
  return {
    domain: {
      chainId: BASE_MAINNET_CONFIG.networkId,
      name: BASE_MAINNET_CONFIG.usdcName,
      verifyingContract: BASE_MAINNET_CONFIG.usdcAddress,
      version: BASE_MAINNET_CONFIG.usdcVersion,
    },
    message: {
      from: input.from,
      nonce: input.nonce,
      to: input.tokenCollector,
      validAfter: "0",
      validBefore: input.validBefore,
      value: parseUnits(input.amount, 6).toString(),
    },
    primaryType: "ReceiveWithAuthorization",
    types: {
      ReceiveWithAuthorization: [...AUTHORIZATION_TYPES.ReceiveWithAuthorization],
    },
  };
}

function parseHostedPaymentLinkPayload(value: unknown): HostedPaymentLinkPayload {
  const payload =
    value && typeof value === "object" && "paymentLink" in value
      ? (value as { paymentLink: unknown }).paymentLink
      : value;

  if (!payload || typeof payload !== "object") {
    throw new Error("Hosted checkout payload was not an object.");
  }

  const paymentLink = payload as Partial<HostedPaymentLinkPayload>;

  if (
    typeof paymentLink.id !== "string" ||
    typeof paymentLink.url !== "string" ||
    typeof paymentLink.maxAmount !== "string" ||
    typeof paymentLink.token !== "string" ||
    typeof paymentLink.networkId !== "number" ||
    typeof paymentLink.receiver !== "string" ||
    typeof paymentLink.preApprovalExpiry !== "string" ||
    typeof paymentLink.nonce !== "string" ||
    typeof paymentLink.contractAddress !== "string"
  ) {
    throw new Error("Hosted checkout payload was missing required fields.");
  }

  return paymentLink as HostedPaymentLinkPayload;
}

function makeAttempt(input: {
  checkout: CoinbaseCheckout;
  checkoutId: string;
  checkoutUrl: string;
}) {
  const now = new Date().toISOString();

  return {
    amount: input.checkout.amount,
    checkoutId: input.checkoutId,
    checkoutUrl: input.checkoutUrl,
    correlationId: crypto.randomUUID(),
    createdAt: now,
    environment: "live" as const,
    id: crypto.randomUUID(),
    network: "base" as const,
    stage: "created" as const,
    token: "USDC" as const,
    updatedAt: now,
  } satisfies AgentCheckoutPaymentAttempt;
}

function mergeAttempt(
  attempt: AgentCheckoutPaymentAttempt,
  updates: Partial<AgentCheckoutPaymentAttempt>,
) {
  return {
    ...attempt,
    ...updates,
    updatedAt: new Date().toISOString(),
  } satisfies AgentCheckoutPaymentAttempt;
}

async function resolveHeadlessCheckout(checkoutId: string) {
  const response = await fetch(
    `${HOSTED_CHECKOUT_ORIGIN}/next-api/payment-links/${checkoutId}`,
    {
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Hosted checkout resolver failed (${response.status}): ${errorText.slice(0, 400)}`,
    );
  }

  return parseHostedPaymentLinkPayload(await response.json());
}

function validateSupportedCheckout(
  checkout: CoinbaseCheckout,
  hostedPaymentLink: HostedPaymentLinkPayload,
) {
  if (checkout.network !== "base") {
    throw new Error(`Unsupported checkout network: ${checkout.network}.`);
  }

  if (checkout.currency.toUpperCase() !== "USDC") {
    throw new Error(`Unsupported checkout currency: ${checkout.currency}.`);
  }

  if (hostedPaymentLink.networkId !== BASE_MAINNET_CONFIG.networkId) {
    throw new Error(`Unsupported hosted checkout network: ${hostedPaymentLink.networkId}.`);
  }

  if (
    normalizeAddress(hostedPaymentLink.token) !==
    normalizeAddress(BASE_MAINNET_CONFIG.usdcAddress)
  ) {
    throw new Error("Hosted checkout token did not match Base USDC.");
  }

  if (
    checkout.address &&
    normalizeAddress(checkout.address) !== normalizeAddress(hostedPaymentLink.receiver)
  ) {
    throw new Error("Hosted checkout receiver drifted from the official checkout payload.");
  }

  if (normalizeAmount(checkout.amount) !== normalizeAmount(hostedPaymentLink.maxAmount)) {
    throw new Error("Hosted checkout amount drifted from the official checkout payload.");
  }
}

async function resolveCheckoutAuthorization(
  checkout: CoinbaseCheckout,
  hostedCheckoutId: string,
) {
  const hostedPaymentLink = await resolveHeadlessCheckout(hostedCheckoutId);
  validateSupportedCheckout(checkout, hostedPaymentLink);

  const paymentInfo = makeAuthorizationRequest({
    amount: hostedPaymentLink.maxAmount,
    from: "0x0000000000000000000000000000000000000000",
    nonce: hostedPaymentLink.nonce,
    tokenCollector: BASE_MAINNET_CONFIG.usdcAuthorizationTokenCollector,
    validBefore: hostedPaymentLink.preApprovalExpiry,
  });

  return {
    callbackUrl: `${HOSTED_CHECKOUT_ORIGIN}/next-api/payment-links/${hostedCheckoutId}/callback`,
    hostedPaymentLink,
    paymentInfo,
    tokenCollector: BASE_MAINNET_CONFIG.usdcAuthorizationTokenCollector,
    version: "v1",
  } satisfies HeadlessCheckoutResolution;
}

async function signHeadlessAuthorization(input: {
  amount: string;
  nonce: `0x${string}`;
  payerPrivateKey: `0x${string}`;
  preApprovalExpiry: string;
  tokenCollector: string;
}) {
  const payer = privateKeyToAccount(input.payerPrivateKey);
  const typedData = makeAuthorizationRequest({
    amount: input.amount,
    from: payer.address,
    nonce: input.nonce,
    tokenCollector: input.tokenCollector,
    validBefore: input.preApprovalExpiry,
  });

  const signature = await payer.signTypedData({
    domain: {
      ...typedData.domain,
      verifyingContract: typedData.domain.verifyingContract as `0x${string}`,
    },
    message: {
      from: typedData.message.from,
      nonce: typedData.message.nonce,
      to: typedData.message.to,
      validAfter: BigInt(typedData.message.validAfter),
      validBefore: BigInt(typedData.message.validBefore),
      value: BigInt(typedData.message.value),
    },
    primaryType: typedData.primaryType,
    types: typedData.types,
  });

  return {
    payerAddress: payer.address,
    paymentInfo: typedData,
    signature,
    signatureRef: crypto.createHash("sha256").update(signature).digest("hex"),
  };
}

async function submitSignedAuthorization(input: {
  callbackUrl: string;
  payerAddress: string;
  signature: string;
  tokenCollector: string;
  userMetadata?: {
    browser: string;
    deviceType: string;
    operatingSystem: string;
    walletProvider: string;
  };
}) {
  const payload = {
    payer: input.payerAddress,
    signature: input.signature,
    tokenCollector: input.tokenCollector,
    userMetadata: input.userMetadata ?? {
      browser: "server",
      deviceType: "server",
      operatingSystem: process.platform,
      walletProvider: "agentic-server",
    },
  };

  const response = await fetch(input.callbackUrl, {
    body: JSON.stringify(payload),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const responseText = await response.text();
  const responseBody = responseText ? safeJsonParse(responseText) : null;
  const traceId = response.headers.get("trace-id") ?? undefined;

  if (!response.ok) {
    const errorMessage =
      responseBody &&
      typeof responseBody === "object" &&
      "error" in responseBody &&
      typeof responseBody.error === "string"
        ? responseBody.error
        : responseText.slice(0, 400);

    const error = new Error(
      `Hosted callback submission failed (${response.status}): ${errorMessage}`,
    ) as Error & { responseBody?: unknown; traceId?: string };
    error.responseBody = responseBody ?? responseText;
    error.traceId = traceId;
    throw error;
  }

  return {
    body: responseBody ?? responseText,
    traceId,
  };
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function isCompletedCheckout(checkout: CoinbaseCheckout) {
  return COMPLETED_CHECKOUT_STATUSES.has(checkout.status.toUpperCase());
}

function isTerminalCheckout(checkout: CoinbaseCheckout) {
  return TERMINAL_CHECKOUT_STATUSES.has(checkout.status.toUpperCase());
}

function sleep(durationMs: number) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function reconcileCheckout(input: {
  checkoutId: string;
  maxPollAttempts: number;
  pollIntervalMs: number;
}) {
  let checkout = await getCheckout(input.checkoutId, "live");

  for (let attempt = 0; attempt < input.maxPollAttempts; attempt += 1) {
    if (isTerminalCheckout(checkout)) {
      return checkout;
    }

    await sleep(input.pollIntervalMs);
    checkout = await getCheckout(input.checkoutId, "live");
  }

  return checkout;
}

export async function startAgenticCheckoutPayment(
  input: StartAgenticCheckoutPaymentInput,
) {
  if (!input.checkoutId?.trim() && input.checkoutUrl?.trim()) {
    throw new Error(
      "URL-only execution is not supported yet. Provide the official Coinbase checkout ID from checkout creation.",
    );
  }

  const checkoutId = extractCheckoutId(input);
  const existingAttempt = await getLatestAgentCheckoutPaymentAttemptByCheckoutId(checkoutId);
  const waitForCompletion = input.waitForCompletion ?? true;
  const pollIntervalMs = Math.min(Math.max(input.pollIntervalMs ?? 3_000, 250), 10_000);
  const maxPollAttempts = Math.min(Math.max(input.maxPollAttempts ?? 20, 1), 60);

  if (existingAttempt?.stage === "completed") {
    return existingAttempt;
  }

  if (existingAttempt?.stage === "submitted" || existingAttempt?.stage === "signed") {
    const checkout = await reconcileCheckout({
      checkoutId,
      maxPollAttempts: waitForCompletion ? maxPollAttempts : 1,
      pollIntervalMs,
    });
    const nextAttempt = mergeAttempt(existingAttempt, {
      errorCode: undefined,
      errorMessage: undefined,
      lastReconciledAt: new Date().toISOString(),
      rawCheckoutStatus: checkout,
      stage: isCompletedCheckout(checkout)
        ? "completed"
        : isTerminalCheckout(checkout)
          ? "failed"
          : existingAttempt.stage,
      txHash: checkout.transactionHash,
    });

    return upsertAgentCheckoutPaymentAttempt(nextAttempt);
  }

  if (existingAttempt?.stage === "failed" && !input.retryFailed) {
    return existingAttempt;
  }

  const checkout = await getCheckout(checkoutId, "live");
  const hostedCheckoutId = extractHostedPaymentLinkId(input.checkoutUrl ?? checkout.url);
  const amountCap = getConfiguredMaxUsdc();
  const hasExternalSignature =
    Boolean(input.signature?.trim()) && Boolean(input.payerAddress?.trim());
  const usesAutonomousServerPayer = !input.dryRun && !hasExternalSignature;

  if (input.checkoutUrl?.trim()) {
    const providedHostedCheckoutId = extractHostedPaymentLinkId(input.checkoutUrl);

    if (providedHostedCheckoutId !== hostedCheckoutId) {
      throw new Error("checkoutUrl did not match the official Coinbase checkout record.");
    }
  }

  if (
    usesAutonomousServerPayer &&
    Number.parseFloat(normalizeAmount(checkout.amount)) >
      Number.parseFloat(amountCap)
  ) {
    throw new Error(
      `Checkout amount ${checkout.amount} exceeds ${HEADLESS_CHECKOUT_MAX_USDC}=${amountCap}.`,
    );
  }

  if (isCompletedCheckout(checkout)) {
    const completedAttempt = mergeAttempt(
      existingAttempt ??
        makeAttempt({
          checkout,
          checkoutId,
          checkoutUrl: checkout.url,
        }),
      {
        rawCheckoutStatus: checkout,
        stage: "completed",
        txHash: checkout.transactionHash,
      },
    );

    return upsertAgentCheckoutPaymentAttempt(completedAttempt);
  }

  if (isTerminalCheckout(checkout)) {
    const failedAttempt = mergeAttempt(
      existingAttempt ??
        makeAttempt({
          checkout,
          checkoutId,
          checkoutUrl: checkout.url,
        }),
      {
        errorCode: checkout.status,
        errorMessage: `Checkout is already ${checkout.status} and cannot be paid.`,
        rawCheckoutStatus: checkout,
        stage: "failed",
      },
    );

    return upsertAgentCheckoutPaymentAttempt(failedAttempt);
  }

  if (
    !input.dryRun &&
    !hasExternalSignature &&
    !isConfiguredFlagEnabled(HEADLESS_CHECKOUT_ENABLED)
  ) {
    throw new Error(
      `${HEADLESS_CHECKOUT_ENABLED} must be true before submitting live headless payments.`,
    );
  }

  let attempt = mergeAttempt(
    existingAttempt ??
      makeAttempt({
        checkout,
        checkoutId,
        checkoutUrl: checkout.url,
      }),
    {
      errorCode: undefined,
      errorMessage: undefined,
      rawCheckoutStatus: checkout,
    },
  );
  attempt = await upsertAgentCheckoutPaymentAttempt(attempt);

  try {
    const resolution = await resolveCheckoutAuthorization(checkout, hostedCheckoutId);
    attempt = await upsertAgentCheckoutPaymentAttempt(
      mergeAttempt(attempt, {
        contractAddress: resolution.hostedPaymentLink.contractAddress,
        paymentInfo: resolution.paymentInfo,
        rawHostedPayload: resolution.hostedPaymentLink,
        stage: "payload_resolved",
        submissionEndpoint: resolution.callbackUrl,
        tokenCollector: resolution.tokenCollector,
        version: resolution.version,
      }),
    );

    if (input.dryRun) {
      return attempt;
    }

    const externallySignedAuthorization =
      hasExternalSignature && input.signature?.trim() && input.payerAddress?.trim()
        ? {
            payerAddress: input.payerAddress.trim(),
            paymentInfo: makeAuthorizationRequest({
              amount: resolution.hostedPaymentLink.maxAmount,
              from: input.payerAddress.trim(),
              nonce: resolution.hostedPaymentLink.nonce,
              tokenCollector: resolution.tokenCollector,
              validBefore: resolution.hostedPaymentLink.preApprovalExpiry,
            }),
            signature: input.signature.trim(),
            signatureRef: crypto
              .createHash("sha256")
              .update(input.signature.trim())
              .digest("hex"),
          }
        : null;

    const signedAuthorization =
      externallySignedAuthorization ??
      (await signHeadlessAuthorization({
        amount: resolution.hostedPaymentLink.maxAmount,
        nonce: resolution.hostedPaymentLink.nonce,
        payerPrivateKey: getAgentWalletPrivateKey(),
        preApprovalExpiry: resolution.hostedPaymentLink.preApprovalExpiry,
        tokenCollector: resolution.tokenCollector,
      }));
    attempt = await upsertAgentCheckoutPaymentAttempt(
      mergeAttempt(attempt, {
        payerAddress: signedAuthorization.payerAddress,
        paymentInfo: signedAuthorization.paymentInfo,
        signatureRef: signedAuthorization.signatureRef,
        stage: "signed",
      }),
    );

    const submission = await submitSignedAuthorization({
      callbackUrl: resolution.callbackUrl,
      payerAddress: signedAuthorization.payerAddress,
      signature: signedAuthorization.signature,
      tokenCollector: resolution.tokenCollector,
      userMetadata: externallySignedAuthorization
        ? {
            browser: "embedded-wallet",
            deviceType: "browser",
            operatingSystem: "web",
            walletProvider: "coinbase-embedded-wallet",
          }
        : undefined,
    });
    attempt = await upsertAgentCheckoutPaymentAttempt(
      mergeAttempt(attempt, {
        rawSubmissionResponse: submission.body,
        stage: "submitted",
        submissionRequestId: submission.traceId,
      }),
    );

    if (!waitForCompletion) {
      return attempt;
    }

    const reconciledCheckout = await reconcileCheckout({
      checkoutId,
      maxPollAttempts,
      pollIntervalMs,
    });
    return upsertAgentCheckoutPaymentAttempt(
      mergeAttempt(attempt, {
        errorCode: isCompletedCheckout(reconciledCheckout)
          ? undefined
          : isTerminalCheckout(reconciledCheckout)
            ? reconciledCheckout.status
            : undefined,
        errorMessage: isCompletedCheckout(reconciledCheckout)
          ? undefined
          : isTerminalCheckout(reconciledCheckout)
            ? `Checkout finished in ${reconciledCheckout.status}.`
            : undefined,
        lastReconciledAt: new Date().toISOString(),
        rawCheckoutStatus: reconciledCheckout,
        stage: isCompletedCheckout(reconciledCheckout)
          ? "completed"
          : isTerminalCheckout(reconciledCheckout)
            ? "failed"
            : "submitted",
        txHash: reconciledCheckout.transactionHash,
      }),
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Headless payment failed.";
    const errorCode =
      error instanceof Error && "traceId" in error && typeof error.traceId === "string"
        ? "submission_failed"
        : "payment_failed";
    const rawSubmissionResponse =
      error &&
      typeof error === "object" &&
      "responseBody" in error &&
      error.responseBody !== undefined
        ? error.responseBody
        : attempt.rawSubmissionResponse;
    const submissionRequestId =
      error &&
      typeof error === "object" &&
      "traceId" in error &&
      typeof error.traceId === "string"
        ? error.traceId
        : attempt.submissionRequestId;

    return upsertAgentCheckoutPaymentAttempt(
      mergeAttempt(attempt, {
        errorCode,
        errorMessage,
        rawSubmissionResponse,
        stage: "failed",
        submissionRequestId,
      }),
    );
  }
}
