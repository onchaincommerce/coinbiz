#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

function loadLocalEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const contents = readFileSync(filePath, "utf8");

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");

    if (equalsIndex <= 0) {
      continue;
    }

    const key = line
      .slice(0, equalsIndex)
      .trim()
      .replace(/^export\s+/, "");
    let value = line.slice(equalsIndex + 1).trim();

    if (!key || process.env[key]?.trim()) {
      continue;
    }

    const first = value.at(0);
    const last = value.at(-1);

    if (
      value.length >= 2 &&
      ((first === "\"" && last === "\"") || (first === "'" && last === "'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function loadLocalEnv() {
  const cwd = process.cwd();

  loadLocalEnvFile(resolve(cwd, ".env"));
  loadLocalEnvFile(resolve(cwd, ".env.local"));
}

loadLocalEnv();

function printUsage() {
  console.log(`Usage:
  npm run coinbase:headless-pay -- [options]

Options:
  --base-url <url>           Local app base URL. Default: http://127.0.0.1:3000
  --amount <amount>          Checkout amount in USDC. Default: 0.01
  --description <text>       Checkout description.
  --environment <env>        Coinbase environment: live | sandbox. Default: live
  --reference <text>         Metadata reference string.
  --checkout-id <id>         Use an existing checkout instead of creating one.
  --skip-dry-run             Skip the payload-resolution dry run.
  --dry-run-only             Stop after the payload-resolution dry run.
  --no-wait                  Do not wait for completion in the agentic payment route.
  --max-poll-attempts <n>    Override server-side agentic payment polling attempts.
  --poll-interval-ms <n>     Override server-side agentic payment poll interval.
  --retry-failed             Retry a previously failed payment attempt.
  --check-env                Verify local headless env without creating or paying.
  --help                     Show this help text.

Environment:
  The script auto-loads .env and .env.local from the repo root.
  HEADLESS_PAYMENT_INTERNAL_TOKEN must be set for live server-signer execution.

Examples:
  npm run coinbase:headless-pay --
  npm run coinbase:headless-pay -- --amount 0.01 --description "headless test payment"
  npm run coinbase:headless-pay -- --checkout-id 69e3a1249593665bca992e42
`);
}

function parseArgs(argv) {
  const options = {
    amount: "0.01",
    baseUrl: process.env.BASE_URL ?? "http://127.0.0.1:3000",
    checkoutId: undefined,
    description: "CLI headless canary",
    dryRunOnly: false,
    environment: "live",
    maxPollAttempts: undefined,
    pollIntervalMs: undefined,
    reference: `cli-${Date.now()}`,
    retryFailed: false,
    skipDryRun: false,
    waitForCompletion: true,
    checkEnv: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    switch (argument) {
      case "--base-url":
        options.baseUrl = argv[index + 1];
        index += 1;
        break;
      case "--amount":
        options.amount = argv[index + 1];
        index += 1;
        break;
      case "--description":
        options.description = argv[index + 1];
        index += 1;
        break;
      case "--environment":
        options.environment = argv[index + 1];
        index += 1;
        break;
      case "--reference":
        options.reference = argv[index + 1];
        index += 1;
        break;
      case "--checkout-id":
        options.checkoutId = argv[index + 1];
        index += 1;
        break;
      case "--max-poll-attempts":
        options.maxPollAttempts = Number.parseInt(argv[index + 1], 10);
        index += 1;
        break;
      case "--poll-interval-ms":
        options.pollIntervalMs = Number.parseInt(argv[index + 1], 10);
        index += 1;
        break;
      case "--skip-dry-run":
        options.skipDryRun = true;
        break;
      case "--dry-run-only":
        options.dryRunOnly = true;
        break;
      case "--no-wait":
        options.waitForCompletion = false;
        break;
      case "--retry-failed":
        options.retryFailed = true;
        break;
      case "--check-env":
        options.checkEnv = true;
        break;
      case "--help":
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return options;
}

function checkEnv() {
  const required = [
    "HEADLESS_PAYMENT_INTERNAL_TOKEN",
    "HEADLESS_CHECKOUT_PAYER_ENABLED",
    "HEADLESS_CHECKOUT_PAYER_MAX_USDC",
    "HEADLESS_CHECKOUT_PAYER_PRIVATE_KEY",
  ];

  logSection("Local Headless Environment");

  let missingCount = 0;

  for (const key of required) {
    const value = process.env[key]?.trim();

    if (!value) {
      missingCount += 1;
    }

    logKeyValue(key, value ? `configured (${value.length} chars)` : "missing");
  }

  if (missingCount > 0) {
    process.exitCode = 1;
  }
}

function buildHeaders(body, requireInternalAuth = false) {
  const headers = {};

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  if (requireInternalAuth) {
    const token = process.env.HEADLESS_PAYMENT_INTERNAL_TOKEN?.trim();

    if (!token) {
      throw new Error(
        "HEADLESS_PAYMENT_INTERNAL_TOKEN is required for server-signer headless payment execution.",
      );
    }

    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function requestJson(method, url, body, options = {}) {
  const response = await fetch(url, {
    body: body ? JSON.stringify(body) : undefined,
    headers: buildHeaders(body, Boolean(options.requireInternalAuth)),
    method,
  });

  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error(
        `Invalid JSON from ${url}: ${error instanceof Error ? error.message : text}`,
      );
    }
  }

  return { data, response };
}

function assertOption(name, value) {
  if (!value) {
    throw new Error(`Missing required value for ${name}.`);
  }

  return value;
}

function logSection(title) {
  console.log(`\n== ${title} ==`);
}

function logKeyValue(label, value) {
  console.log(`${label}: ${value ?? "-"}`);
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function isValidAmount(value) {
  return /^\d+(\.\d{1,2})?$/.test(value) && Number(value) > 0;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.checkEnv) {
    checkEnv();
    return;
  }

  const baseUrl = normalizeBaseUrl(assertOption("--base-url", options.baseUrl));

  if (!["live", "sandbox"].includes(options.environment)) {
    throw new Error("--environment must be either live or sandbox.");
  }

  if (!options.checkoutId && !isValidAmount(options.amount)) {
    throw new Error("--amount must be a positive string with up to 2 decimals.");
  }

  if (
    options.maxPollAttempts !== undefined &&
    (!Number.isInteger(options.maxPollAttempts) || options.maxPollAttempts <= 0)
  ) {
    throw new Error("--max-poll-attempts must be a positive integer.");
  }

  if (
    options.pollIntervalMs !== undefined &&
    (!Number.isInteger(options.pollIntervalMs) || options.pollIntervalMs <= 0)
  ) {
    throw new Error("--poll-interval-ms must be a positive integer.");
  }

  let checkoutId = options.checkoutId;

  if (!checkoutId) {
    logSection("Create Checkout");

    const createPayload = {
      amount: options.amount,
      description: options.description,
      environment: options.environment,
      metadata: {
        rail: "script-headless",
        reference: options.reference,
      },
    };

    const { data, response } = await requestJson(
      "POST",
      `${baseUrl}/api/coinbase/checkouts`,
      createPayload,
    );

    if (!response.ok || !data?.checkout?.id) {
      throw new Error(data?.error ?? "Unable to create the checkout.");
    }

    checkoutId = data.checkout.id;
    logKeyValue("checkoutId", checkoutId);
    logKeyValue("checkoutUrl", data.checkout.url);
    logKeyValue("amount", data.checkout.amount);
    logKeyValue("environment", options.environment);
  } else {
    logSection("Use Existing Checkout");
    logKeyValue("checkoutId", checkoutId);
    logKeyValue("environment", options.environment);
  }

  if (!options.skipDryRun) {
    logSection("Dry Run");

    const { data, response } = await requestJson(
      "POST",
      `${baseUrl}/api/coinbase/agentic-payments`,
      {
        checkoutId,
        dryRun: true,
      },
    );

    if (!response.ok || !data?.attempt) {
      throw new Error(data?.error ?? "Dry run failed.");
    }

    logKeyValue("attemptId", data.attempt.id);
    logKeyValue("stage", data.attempt.stage);
    logKeyValue("submissionEndpoint", data.attempt.submissionEndpoint);
  }

  if (options.dryRunOnly) {
    logSection("Done");
    console.log("Dry run completed.");
    return;
  }

  logSection("Execute Headless Payment");

  const executePayload = {
    checkoutId,
    maxPollAttempts: options.maxPollAttempts,
    pollIntervalMs: options.pollIntervalMs,
    retryFailed: options.retryFailed,
    waitForCompletion: options.waitForCompletion,
  };

  const { data: paymentData, response: paymentResponse } = await requestJson(
    "POST",
    `${baseUrl}/api/coinbase/agentic-payments`,
    executePayload,
    {
      requireInternalAuth: true,
    },
  );

  if (![200, 202, 409].includes(paymentResponse.status) || !paymentData?.attempt) {
    throw new Error(paymentData?.error ?? "Unable to execute the headless payment.");
  }

  logKeyValue("attemptId", paymentData.attempt.id);
  logKeyValue("stage", paymentData.attempt.stage);
  logKeyValue("payerAddress", paymentData.attempt.payerAddress);
  logKeyValue("txHash", paymentData.attempt.txHash);

  if (paymentData.attempt.errorMessage) {
    logKeyValue("attemptError", paymentData.attempt.errorMessage);
  }

  logSection("Official Checkout Status");

  const { data: checkoutData, response: checkoutResponse } = await requestJson(
    "GET",
    `${baseUrl}/api/coinbase/checkouts/${checkoutId}?environment=${options.environment}`,
  );

  if (!checkoutResponse.ok || !checkoutData?.checkout) {
    throw new Error(checkoutData?.error ?? "Unable to load the official checkout status.");
  }

  const checkout = checkoutData.checkout;

  logKeyValue("checkoutId", checkout.id);
  logKeyValue("status", checkout.status);
  logKeyValue("transactionHash", checkout.transactionHash);
  logKeyValue("hostedUrl", checkout.url);

  if (checkout.transactionHash && checkout.network === "base") {
    logKeyValue("basescan", `https://basescan.org/tx/${checkout.transactionHash}`);
  }

  if (paymentData.attempt.stage === "failed" || checkout.status !== "COMPLETED") {
    process.exitCode = 1;
    logSection("Result");
    console.error("Headless payment did not finish in COMPLETED state.");
    return;
  }

  logSection("Result");
  console.log("Headless payment completed successfully.");
}

main().catch((error) => {
  console.error("\nHeadless payment script failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
