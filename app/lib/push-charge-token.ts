import crypto from "node:crypto";

import type {
  CheckoutEnvironment,
  PushAsset,
  PushNetwork,
} from "@/app/lib/coinbase-types";

export type PushChargeTokenPayload = {
  accountId: string;
  address: string;
  addressId: string;
  amountUsd: string;
  asset: PushAsset;
  chargeId: string;
  createdAt: string;
  environment: CheckoutEnvironment;
  metadata: Record<string, string>;
  network: PushNetwork;
  note?: string;
  quoteExpiresAt: string;
  quoteRateUsd: string;
  quotedAmount: string;
  reference: string;
};

const PUSH_TOKEN_VERSION = "v1";

function base64UrlEncode(value: Buffer | string) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  return buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function getPushStateSecret() {
  return (
    process.env.COINBASE_PUSH_STATE_SECRET?.trim() ??
    process.env.CDP_API_KEY_SECRET?.trim() ??
    ""
  );
}

function getSignature(value: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(value, "utf8").digest();
}

export function signPushChargeToken(payload: PushChargeTokenPayload) {
  const secret = getPushStateSecret();

  if (!secret) {
    throw new Error(
      "Push payments require COINBASE_PUSH_STATE_SECRET or CDP_API_KEY_SECRET.",
    );
  }

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${PUSH_TOKEN_VERSION}.${encodedPayload}`;
  const signature = base64UrlEncode(getSignature(signingInput, secret));

  return `${signingInput}.${signature}`;
}

export function verifyPushChargeToken(token: string): PushChargeTokenPayload {
  const secret = getPushStateSecret();

  if (!secret) {
    throw new Error(
      "Push payments require COINBASE_PUSH_STATE_SECRET or CDP_API_KEY_SECRET.",
    );
  }

  const [version, encodedPayload, encodedSignature] = token.split(".");

  if (!version || !encodedPayload || !encodedSignature) {
    throw new Error("Push charge token is malformed.");
  }

  if (version !== PUSH_TOKEN_VERSION) {
    throw new Error("Push charge token version is not supported.");
  }

  const expectedSignature = getSignature(`${version}.${encodedPayload}`, secret);
  const actualSignature = Buffer.from(
    encodedSignature.replaceAll("-", "+").replaceAll("_", "/"),
    "base64",
  );

  if (expectedSignature.length !== actualSignature.length) {
    throw new Error("Push charge token signature is invalid.");
  }

  if (!crypto.timingSafeEqual(expectedSignature, actualSignature)) {
    throw new Error("Push charge token signature is invalid.");
  }

  try {
    return JSON.parse(
      Buffer.from(
        encodedPayload.replaceAll("-", "+").replaceAll("_", "/"),
        "base64",
      ).toString("utf8"),
    ) as PushChargeTokenPayload;
  } catch {
    throw new Error("Push charge token payload is invalid.");
  }
}
