import crypto from "node:crypto";

import type {
  CoinbaseAddressResource,
  CoinbaseAppAccount,
  CheckoutEnvironment,
  CoinbaseCheckout,
  CoinbaseCheckoutListResponse,
  CoinbaseExchangeRates,
  CoinbaseTransaction,
  DemoStatePayload,
  PushAsset,
} from "@/app/lib/coinbase-types";

const COINBASE_APP_HOST = "api.coinbase.com";
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

type CoinbaseAppListResponse<T> = {
  data: T[];
};

type CoinbaseAppSingleResponse<T> = {
  data: T;
};

type CoinbaseTrackAccountResponse = {
  allow_deposits?: boolean;
  allow_withdrawals?: boolean;
  balance: {
    amount: string;
    currency: string;
  };
  created_at?: string;
  currency: {
    code: string;
    exponent?: number;
    name?: string;
    type?: string;
  };
  id: string;
  name: string;
  portfolio_id?: string;
  primary?: boolean;
  resource_path?: string;
  type?: string;
  updated_at?: string;
};

type CoinbaseExchangeRatesResponse = {
  data: {
    currency: string;
    rates: Record<string, string>;
  };
};

type CoinbaseTrackAddressResponse = {
  address: string;
  created_at?: string;
  id: string;
  name?: string | null;
  network?: string | null;
  resource_path?: string;
  updated_at?: string;
};

type CoinbaseTrackTransactionResponse = {
  amount: {
    amount: string;
    currency: string;
  };
  created_at?: string;
  from?: {
    address?: string;
    id?: string;
    resource?: string | null;
    resource_path?: string;
  };
  id: string;
  native_amount?: {
    amount: string;
    currency: string;
  };
  network?: {
    hash?: string;
    network_name?: string;
    status?: string;
  };
  resource_path?: string;
  status: string;
  to?: {
    address?: string;
    id?: string;
    resource?: string | null;
    resource_path?: string;
  };
  type: string;
  updated_at?: string;
};

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

async function appFetch<T>({
  body,
  idempotencyKey,
  method,
  path,
}: Omit<CoinbaseRequestConfig, "host">): Promise<T> {
  return coinbaseFetch<T>({
    body,
    host: COINBASE_APP_HOST,
    idempotencyKey,
    method,
    path,
  });
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

export async function listCheckouts(input: {
  environment: CheckoutEnvironment;
  pageSize?: number;
  pageToken?: string;
}): Promise<CoinbaseCheckoutListResponse> {
  const searchParams = new URLSearchParams();

  if (input.pageSize) {
    searchParams.set("pageSize", String(input.pageSize));
  }

  if (input.pageToken) {
    searchParams.set("pageToken", input.pageToken);
  }

  const query = searchParams.toString();

  return coinbaseFetch<CoinbaseCheckoutListResponse>({
    host: COINBASE_BUSINESS_HOST,
    method: "GET",
    path: `${getCheckoutPath(input.environment)}${query ? `?${query}` : ""}`,
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

function mapTrackAccount(account: CoinbaseTrackAccountResponse): CoinbaseAppAccount {
  return {
    allowDeposits: Boolean(account.allow_deposits),
    allowWithdrawals: Boolean(account.allow_withdrawals),
    balance: account.balance,
    createdAt: account.created_at,
    currency: {
      code: account.currency.code,
      exponent: account.currency.exponent ?? 8,
      name: account.currency.name ?? account.currency.code,
      type: account.currency.type ?? "crypto",
    },
    id: account.id,
    name: account.name,
    portfolioId: account.portfolio_id,
    primary: Boolean(account.primary),
    resourcePath: account.resource_path,
    type: account.type ?? "wallet",
    updatedAt: account.updated_at,
  };
}

function mapExchangeRates(
  response: CoinbaseExchangeRatesResponse,
): CoinbaseExchangeRates {
  return {
    currency: response.data.currency,
    rates: response.data.rates,
  };
}

function mapTrackAddress(
  address: CoinbaseTrackAddressResponse,
): CoinbaseAddressResource {
  return {
    address: address.address,
    createdAt: address.created_at,
    id: address.id,
    name: address.name,
    network: address.network,
    resourcePath: address.resource_path,
    updatedAt: address.updated_at,
  };
}

function mapTrackTransaction(
  transaction: CoinbaseTrackTransactionResponse,
): CoinbaseTransaction {
  return {
    amount: transaction.amount,
    createdAt: transaction.created_at,
    from: transaction.from
      ? {
          address: transaction.from.address,
          id: transaction.from.id,
          resource: transaction.from.resource,
          resourcePath: transaction.from.resource_path,
        }
      : undefined,
    id: transaction.id,
    nativeAmount: transaction.native_amount,
    network: transaction.network
      ? {
          hash: transaction.network.hash,
          networkName: transaction.network.network_name,
          status: transaction.network.status,
        }
      : undefined,
    resourcePath: transaction.resource_path,
    status: transaction.status,
    to: transaction.to
      ? {
          address: transaction.to.address,
          id: transaction.to.id,
          resource: transaction.to.resource,
          resourcePath: transaction.to.resource_path,
        }
      : undefined,
    type: transaction.type,
    updatedAt: transaction.updated_at,
  };
}

export async function listWalletAccounts(): Promise<CoinbaseAppAccount[]> {
  const response = await appFetch<CoinbaseAppListResponse<CoinbaseTrackAccountResponse>>({
    method: "GET",
    path: "/v2/accounts",
  });

  return response.data.map(mapTrackAccount);
}

export async function getExchangeRates(currency: PushAsset): Promise<CoinbaseExchangeRates> {
  const response = await fetch(
    `https://${COINBASE_APP_HOST}/v2/exchange-rates?currency=${currency}`,
    { cache: "no-store" },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Coinbase exchange rates request failed (${response.status}): ${errorText.slice(0, 400)}`,
    );
  }

  return mapExchangeRates((await response.json()) as CoinbaseExchangeRatesResponse);
}

export async function createOnchainAddress(input: {
  accountId: string;
  name?: string;
  network?: string;
}): Promise<CoinbaseAddressResource> {
  const payload: JsonValue = {};

  if (input.name) {
    (payload as Record<string, JsonValue>).name = input.name;
  }

  if (input.network) {
    (payload as Record<string, JsonValue>).network = input.network;
  }

  const response = await appFetch<CoinbaseAppSingleResponse<CoinbaseTrackAddressResponse>>({
    body: payload,
    idempotencyKey: crypto.randomUUID(),
    method: "POST",
    path: `/v2/accounts/${input.accountId}/addresses`,
  });

  return mapTrackAddress(response.data);
}

export async function listAddressTransactions(input: {
  accountId: string;
  addressId: string;
}): Promise<CoinbaseTransaction[]> {
  const response = await appFetch<CoinbaseAppListResponse<CoinbaseTrackTransactionResponse>>({
    method: "GET",
    path: `/v2/accounts/${input.accountId}/addresses/${input.addressId}/transactions`,
  });

  return response.data.map(mapTrackTransaction);
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
