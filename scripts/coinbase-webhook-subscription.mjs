#!/usr/bin/env node

import crypto from "node:crypto";

const API_KEY_ID = process.env.CDP_API_KEY_ID?.trim() ?? "";
const API_KEY_SECRET = process.env.CDP_API_KEY_SECRET?.trim() ?? "";
const HOST = "api.cdp.coinbase.com";
const BASE_PATH = "/platform/v2/data/webhooks/subscriptions";

function usage() {
  console.error(`Usage:
  npm run coinbase:webhook -- list
  npm run coinbase:webhook -- get <subscriptionId>
  npm run coinbase:webhook -- create <sandbox|live> <targetUrl>
  npm run coinbase:webhook -- update <subscriptionId> <sandbox|live> <targetUrl>`);
  process.exit(1);
}

function assertCredentials() {
  if (!API_KEY_ID || !API_KEY_SECRET) {
    throw new Error(
      "Missing CDP_API_KEY_ID or CDP_API_KEY_SECRET. Load them from your local env first.",
    );
  }
}

function base64UrlEncode(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  return buffer
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function createPrivateKey(secret) {
  const decoded = Buffer.from(secret, "base64");
  const seed = decoded.length >= 32 ? decoded.subarray(0, 32) : decoded;
  const pkcs8Header = Buffer.from("302e020100300506032b657004220420", "hex");

  return crypto.createPrivateKey({
    format: "der",
    key: Buffer.concat([pkcs8Header, seed]),
    type: "pkcs8",
  });
}

function generateJwt(method, path) {
  assertCredentials();

  const key = createPrivateKey(API_KEY_SECRET);
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "EdDSA",
    kid: API_KEY_ID,
    nonce: crypto.randomBytes(16).toString("hex"),
    typ: "JWT",
  };
  const payload = {
    aud: ["cdp_service"],
    exp: now + 120,
    iss: "cdp",
    nbf: now,
    sub: API_KEY_ID,
    uri: `${method.toUpperCase()} ${HOST}${path}`,
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const signature = crypto.sign(
    null,
    Buffer.from(signingInput, "utf8"),
    key,
  );

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function assertEnvironment(value) {
  if (value !== "sandbox" && value !== "live") {
    throw new Error("Environment must be sandbox or live.");
  }
}

function assertTargetUrl(targetUrl) {
  if (!targetUrl?.startsWith("https://")) {
    throw new Error("Webhook target URL must start with https://");
  }
}

function buildBody(environment, targetUrl) {
  const body = {
    description: `${environment === "sandbox" ? "Sandbox" : "Live"} checkout webhooks`,
    eventTypes: [
      "checkout.payment.success",
      "checkout.payment.failed",
      "checkout.payment.expired",
    ],
    isEnabled: true,
    target: {
      method: "POST",
      url: targetUrl,
    },
  };

  if (environment === "sandbox") {
    body.labels = { sandbox: "true" };
  }

  return body;
}

async function callCoinbase(method, path, body) {
  const headers = new Headers({
    Authorization: `Bearer ${generateJwt(method, path)}`,
  });

  if (body) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`https://${HOST}${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers,
    method,
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Coinbase returned ${response.status}: ${text}`);
  }

  return text ? JSON.parse(text) : {};
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command) {
    usage();
  }

  let result;

  switch (command) {
    case "list":
      result = await callCoinbase("GET", BASE_PATH);
      break;
    case "get": {
      const [subscriptionId] = args;
      if (!subscriptionId) {
        usage();
      }
      result = await callCoinbase("GET", `${BASE_PATH}/${subscriptionId}`);
      break;
    }
    case "create": {
      const [environment, targetUrl] = args;
      assertEnvironment(environment);
      assertTargetUrl(targetUrl);
      result = await callCoinbase(
        "POST",
        BASE_PATH,
        buildBody(environment, targetUrl),
      );
      break;
    }
    case "update": {
      const [subscriptionId, environment, targetUrl] = args;
      if (!subscriptionId) {
        usage();
      }
      assertEnvironment(environment);
      assertTargetUrl(targetUrl);
      result = await callCoinbase(
        "PUT",
        `${BASE_PATH}/${subscriptionId}`,
        buildBody(environment, targetUrl),
      );
      break;
    }
    default:
      usage();
  }

  console.log(JSON.stringify(result, null, 2));

  if (result.subscriptionId) {
    console.log(`subscriptionId: ${result.subscriptionId}`);
  }

  if (result.metadata?.secret) {
    console.log(`webhookSecret: ${result.metadata.secret}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
