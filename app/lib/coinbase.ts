import crypto from "node:crypto";

import type {
  CheckoutEnvironment,
  CoinbaseCheckout,
  DemoStatePayload,
} from "@/app/lib/coinbase-types";

const COINBASE_BUSINESS_HOST = "business.coinbase.com";
const COINBASE_PLATFORM_HOST = "api.cdp.coinbase.com";
const DEFAULT_WEBHOOK_MAX_AGE_MINUTES = 5;

type JsonValue =
  | boolean
  | null
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type CoinbaseRequestConfig = {
  body?: JsonValue;
  host: string;
  idempotencyKey?: string;
  method: "GET" | "POST" | "PUT";
  path: string;
};

export interface CreateCheckoutInput {
  amount: string;
  description?: string;
  environment: CheckoutEnvironment;
  expiresAt?: string;
  failRedirectUrl?: string;
  metadata?: Record<string, string>;
  successRedirectUrl?: string;
}

type HeaderShape = Headers | Record<string, string | string[] | undefined>;

function isTruthyString(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function base64UrlEncode(value: Buffer | string) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  return buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function getApiKeyId() {
  return process.env.CDP_API_KEY_ID?.trim() ?? "";
}

function getApiKeySecret() {
  return process.env.CDP_API_KEY_SECRET?.trim() ?? "";
}

function getEd25519PrivateKey(secret: string) {
  const decoded = Buffer.from(secret, "base64");
  const seed =
    decoded.length >= 32 ? decoded.subarray(0, 32) : Buffer.from(secret, "utf8");
  const pkcs8Header = Buffer.from("302e020100300506032b657004220420", "hex");
  return crypto.createPrivateKey({
    format: "der",
    key: Buffer.concat([pkcs8Header, seed]),
    type: "pkcs8",
  });
}

function getSigningKey(secret: string) {
  if (secret.startsWith("-----BEGIN")) {
    return crypto.createPrivateKey(secret);
  }

  return getEd25519PrivateKey(secret);
}

function getJwtAlgorithm(key: crypto.KeyObject) {
  if (key.asymmetricKeyType === "ed25519") {
    return "EdDSA";
  }

  throw new Error(
    "This demo currently expects an Ed25519 CDP secret API key. Rotate the key if needed.",
  );
}

export function areCoinbaseCredentialsConfigured() {
  return isTruthyString(getApiKeyId()) && isTruthyString(getApiKeySecret());
}

export function getWebhookPath(environment: CheckoutEnvironment) {
  return `/api/coinbase/webhooks/${environment}`;
}

export function getDemoConfig(): Pick<
  DemoStatePayload,
  "credentialsConfigured" | "webhookPaths" | "webhookSecretsConfigured"
> {
  return {
    credentialsConfigured: areCoinbaseCredentialsConfigured(),
    webhookPaths: {
      live: getWebhookPath("live"),
      sandbox: getWebhookPath("sandbox"),
    },
    webhookSecretsConfigured: {
      live: Boolean(getWebhookSecret("live")),
      sandbox: Boolean(getWebhookSecret("sandbox")),
    },
  };
}

export function generateCdpJwt(request: {
  requestHost: string;
  requestMethod: string;
  requestPath: string;
}) {
  const apiKeyId = getApiKeyId();
  const apiKeySecret = getApiKeySecret();

  if (!apiKeyId || !apiKeySecret) {
    throw new Error(
      "Missing CDP API credentials. Set CDP_API_KEY_ID and CDP_API_KEY_SECRET.",
    );
  }

  const key = getSigningKey(apiKeySecret);
  const algorithm = getJwtAlgorithm(key);
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: algorithm,
    kid: apiKeyId,
    nonce: crypto.randomBytes(16).toString("hex"),
    typ: "JWT",
  };

  const payload = {
    aud: ["cdp_service"],
    exp: now + 120,
    iss: "cdp",
    nbf: now,
    sub: apiKeyId,
    uri: `${request.requestMethod.toUpperCase()} ${request.requestHost}${request.requestPath}`,
  };

  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signature = crypto.sign(
    null,
    Buffer.from(signingInput, "utf8"),
    key,
  );

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

async function coinbaseFetch<T>({
  body,
  host,
  idempotencyKey,
  method,
  path,
}: CoinbaseRequestConfig): Promise<T> {
  const token = generateCdpJwt({
    requestHost: host,
    requestMethod: method,
    requestPath: path,
  });

  const headers = new Headers({
    Authorization: `Bearer ${token}`,
  });

  if (body) {
    headers.set("Content-Type", "application/json");
  }

  if (idempotencyKey) {
    headers.set("X-Idempotency-Key", idempotencyKey);
  }

  const response = await fetch(`https://${host}${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers,
    method,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Coinbase API request failed (${response.status}): ${errorText.slice(0, 400)}`,
    );
  }

  return (await response.json()) as T;
}

function getCheckoutPath(environment: CheckoutEnvironment, checkoutId?: string) {
  const prefix = environment === "sandbox" ? "/sandbox" : "";
  const idPath = checkoutId ? `/${checkoutId}` : "";
  return `${prefix}/api/v1/checkouts${idPath}`;
}

export async function createCheckout(
  input: CreateCheckoutInput,
): Promise<CoinbaseCheckout> {
  const payload: JsonValue = {
    amount: input.amount,
    currency: "USDC",
    network: "base",
  };

  if (input.description) {
    (payload as Record<string, JsonValue>).description = input.description;
  }

  if (input.expiresAt) {
    (payload as Record<string, JsonValue>).expiresAt = input.expiresAt;
  }

  if (input.successRedirectUrl) {
    (payload as Record<string, JsonValue>).successRedirectUrl =
      input.successRedirectUrl;
  }

  if (input.failRedirectUrl) {
    (payload as Record<string, JsonValue>).failRedirectUrl = input.failRedirectUrl;
  }

  if (input.metadata && Object.keys(input.metadata).length > 0) {
    (payload as Record<string, JsonValue>).metadata = input.metadata;
  }

  return coinbaseFetch<CoinbaseCheckout>({
    body: payload,
    host: COINBASE_BUSINESS_HOST,
    idempotencyKey: crypto.randomUUID(),
    method: "POST",
    path: getCheckoutPath(input.environment),
  });
}

export async function getCheckout(
  checkoutId: string,
  environment: CheckoutEnvironment,
): Promise<CoinbaseCheckout> {
  return coinbaseFetch<CoinbaseCheckout>({
    host: COINBASE_BUSINESS_HOST,
    method: "GET",
    path: getCheckoutPath(environment, checkoutId),
  });
}

export async function callPlatformWebhooksApi<T>(
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: JsonValue,
) {
  return coinbaseFetch<T>({
    body,
    host: COINBASE_PLATFORM_HOST,
    method,
    path,
  });
}

export function getWebhookSecret(environment: CheckoutEnvironment) {
  if (environment === "sandbox") {
    return process.env.COINBASE_WEBHOOK_SANDBOX_SECRET?.trim() ?? "";
  }

  return process.env.COINBASE_WEBHOOK_LIVE_SECRET?.trim() ?? "";
}

function readHeader(headerBag: HeaderShape, headerName: string) {
  const normalizedName = headerName.toLowerCase();

  if (headerBag instanceof Headers) {
    return headerBag.get(normalizedName) ?? headerBag.get(headerName) ?? "";
  }

  for (const [key, value] of Object.entries(headerBag)) {
    if (key.toLowerCase() !== normalizedName) {
      continue;
    }

    if (Array.isArray(value)) {
      return value.join(",");
    }

    return value ?? "";
  }

  return "";
}

export function verifyWebhookSignature(input: {
  headers: HeaderShape;
  maxAgeMinutes?: number;
  payload: string;
  secret: string;
  signatureHeader: string;
}) {
  try {
    const parts = Object.fromEntries(
      input.signatureHeader.split(",").map((entry) => {
        const [key, ...rest] = entry.trim().split("=");
        return [key, rest.join("=")];
      }),
    );

    const timestamp = parts.t;
    const headerNames = parts.h;
    const providedSignature = parts.v1;

    if (!timestamp || !headerNames || !providedSignature) {
      return false;
    }

    const headerValues = headerNames
      .split(" ")
      .map((name) => readHeader(input.headers, name))
      .join(".");

    const signedPayload = `${timestamp}.${headerNames}.${headerValues}.${input.payload}`;
    const expectedSignature = crypto
      .createHmac("sha256", input.secret)
      .update(signedPayload, "utf8")
      .digest();
    const actualSignature = Buffer.from(providedSignature, "hex");

    if (expectedSignature.length !== actualSignature.length) {
      return false;
    }

    const webhookTime = Number.parseInt(timestamp, 10) * 1000;
    const ageMinutes = (Date.now() - webhookTime) / (1000 * 60);
    const configuredMaxAgeMinutes = Number.parseInt(
      process.env.COINBASE_WEBHOOK_MAX_AGE_MINUTES ?? "",
      10,
    );
    const maxAgeMinutes =
      input.maxAgeMinutes ??
      (Number.isFinite(configuredMaxAgeMinutes)
        ? configuredMaxAgeMinutes
        : undefined) ??
      DEFAULT_WEBHOOK_MAX_AGE_MINUTES;

    if (ageMinutes > maxAgeMinutes) {
      return false;
    }

    return crypto.timingSafeEqual(expectedSignature, actualSignature);
  } catch {
    return false;
  }
}
