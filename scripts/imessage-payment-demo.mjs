#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

const execFileAsync = promisify(execFile);
const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1);

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
  npm run imessage:payment-demo -- --recipient <phone-or-email> [options]

Options:
  --recipient <value>        iMessage recipient that must reply YES.
  --base-url <url>           Local app base URL. Default: http://127.0.0.1:3000
  --amount <amount>          Checkout amount in USDC. Default: 0.01
  --description <text>       Checkout description.
  --reference <text>         Metadata reference string.
  --environment <env>        Coinbase environment: live | sandbox. Default: live
  --approval-word <text>     Required reply text. Default: YES
  --timeout-ms <n>           Approval timeout. Default: 180000
  --poll-interval-ms <n>     Messages DB polling interval. Default: 2000
  --skip-send                Do not send iMessage; only wait for approval.
  --skip-dry-run             Skip payload-resolution dry run after approval.
  --help                     Show this help text.

Environment:
  The script auto-loads .env and .env.local from the repo root.
  HEADLESS_PAYMENT_INTERNAL_TOKEN must be set for payment execution.
  IMESSAGE_PAYMENT_RECIPIENT can provide the default recipient.

Example:
  npm run imessage:payment-demo -- --recipient +15555550123
`);
}

function parseArgs(argv) {
  const options = {
    amount: "0.01",
    approvalWord: "YES",
    baseUrl: process.env.BASE_URL ?? "http://127.0.0.1:3000",
    description: "iMessage approved headless payment",
    environment: "live",
    pollIntervalMs: 2_000,
    recipient: process.env.IMESSAGE_PAYMENT_RECIPIENT,
    reference: `imsg-${Date.now()}`,
    skipDryRun: false,
    skipSend: false,
    timeoutMs: 180_000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    switch (argument) {
      case "--recipient":
        options.recipient = argv[index + 1];
        index += 1;
        break;
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
      case "--reference":
        options.reference = argv[index + 1];
        index += 1;
        break;
      case "--environment":
        options.environment = argv[index + 1];
        index += 1;
        break;
      case "--approval-word":
        options.approvalWord = argv[index + 1];
        index += 1;
        break;
      case "--timeout-ms":
        options.timeoutMs = Number.parseInt(argv[index + 1], 10);
        index += 1;
        break;
      case "--poll-interval-ms":
        options.pollIntervalMs = Number.parseInt(argv[index + 1], 10);
        index += 1;
        break;
      case "--skip-send":
        options.skipSend = true;
        break;
      case "--skip-dry-run":
        options.skipDryRun = true;
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

function assertOption(name, value) {
  if (!value) {
    throw new Error(`Missing required value for ${name}.`);
  }

  return value;
}

function isValidAmount(value) {
  return /^\d+(\.\d{1,2})?$/.test(value) && Number(value) > 0;
}

function normalizeBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

function logSection(title) {
  console.log(`\n== ${title} ==`);
}

function logKeyValue(label, value) {
  console.log(`${label}: ${value ?? "-"}`);
}

function buildHeaders(body, requireInternalAuth = false) {
  const headers = {};

  if (body) {
    headers["Content-Type"] = "application/json";
  }

  if (requireInternalAuth) {
    const token = process.env.HEADLESS_PAYMENT_INTERNAL_TOKEN?.trim();

    if (!token) {
      throw new Error("HEADLESS_PAYMENT_INTERNAL_TOKEN is required.");
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

function appleDateNanoseconds(date) {
  return BigInt(date.getTime() - APPLE_EPOCH_MS) * 1_000_000n;
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function normalizeApproval(value) {
  return value.trim().toUpperCase();
}

async function sendIMessage(input) {
  const script = `
on run argv
  set targetAddress to item 1 of argv
  set bodyText to item 2 of argv
  tell application "Messages"
    set targetService to 1st service whose service type = iMessage
    set targetBuddy to buddy targetAddress of targetService
    send bodyText to targetBuddy
  end tell
end run`;

  await execFileAsync("osascript", ["-e", script, input.recipient, input.message]);
}

async function findApprovalReply(input) {
  const messagesDb = resolve(homedir(), "Library/Messages/chat.db");

  if (!existsSync(messagesDb)) {
    throw new Error(`Messages database not found at ${messagesDb}.`);
  }

  const afterAppleDate = appleDateNanoseconds(input.after).toString();
  const approval = normalizeApproval(input.approvalWord);
  const recipient = input.recipient.trim();
  const query = `
select
  coalesce(message.text, ''),
  handle.id,
  message.date
from message
left join handle on handle.ROWID = message.handle_id
where message.date > ${afterAppleDate}
  and message.is_from_me = 0
  and upper(trim(coalesce(message.text, ''))) = ${sqlString(approval)}
  and handle.id = ${sqlString(recipient)}
order by message.date desc
limit 1;`;

  try {
    const { stdout } = await execFileAsync("sqlite3", ["-separator", "\t", messagesDb, query]);
    const line = stdout.trim();

    if (!line) {
      return null;
    }

    const [text, handle, date] = line.split("\t");

    return { date, handle, text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("Operation not permitted")) {
      throw new Error(
        "Unable to read Messages. Grant Full Disk Access to your terminal app, then rerun the script.",
      );
    }

    throw error;
  }
}

async function waitForApproval(input) {
  const deadline = Date.now() + input.timeoutMs;

  while (Date.now() < deadline) {
    const approval = await findApprovalReply(input);

    if (approval) {
      return approval;
    }

    process.stdout.write(".");
    await new Promise((resolveWait) =>
      setTimeout(resolveWait, input.pollIntervalMs),
    );
  }

  throw new Error(
    `Timed out waiting for ${input.recipient} to reply ${input.approvalWord}. No payment was submitted.`,
  );
}

function makeApprovalMessage(input) {
  return [
    "Coinbase Business Demo approval request",
    `Amount: ${input.amount} USDC`,
    `Description: ${input.description}`,
    `Reference: ${input.reference}`,
    `Checkout: ${input.checkoutUrl}`,
    "",
    `Reply ${input.approvalWord} to approve the headless payment.`,
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const recipient = assertOption("--recipient", options.recipient).trim();
  const baseUrl = normalizeBaseUrl(assertOption("--base-url", options.baseUrl));

  if (!["live", "sandbox"].includes(options.environment)) {
    throw new Error("--environment must be either live or sandbox.");
  }

  if (!isValidAmount(options.amount)) {
    throw new Error("--amount must be a positive string with up to 2 decimals.");
  }

  if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive integer.");
  }

  if (!Number.isInteger(options.pollIntervalMs) || options.pollIntervalMs <= 0) {
    throw new Error("--poll-interval-ms must be a positive integer.");
  }

  logSection("Create Checkout");

  const { data: checkoutData, response: checkoutResponse } = await requestJson(
    "POST",
    `${baseUrl}/api/coinbase/checkouts`,
    {
      amount: options.amount,
      description: options.description,
      environment: options.environment,
      metadata: {
        approval_surface: "imessage",
        approval_word: normalizeApproval(options.approvalWord),
        reference: options.reference,
      },
    },
  );

  if (!checkoutResponse.ok || !checkoutData?.checkout?.id) {
    throw new Error(checkoutData?.error ?? "Unable to create the checkout.");
  }

  const checkout = checkoutData.checkout;
  const approvalStartedAt = new Date();

  logKeyValue("checkoutId", checkout.id);
  logKeyValue("checkoutUrl", checkout.url);
  logKeyValue("amount", checkout.amount);
  logKeyValue("recipient", recipient);

  if (!options.skipSend) {
    logSection("Send iMessage");
    await sendIMessage({
      message: makeApprovalMessage({
        amount: checkout.amount,
        checkoutUrl: checkout.url,
        description: options.description,
        reference: options.reference,
        approvalWord: normalizeApproval(options.approvalWord),
      }),
      recipient,
    });
    console.log("Approval request sent.");
  }

  logSection("Wait For Approval");
  console.log(`Waiting for ${recipient} to reply ${normalizeApproval(options.approvalWord)}.`);
  const approval = await waitForApproval({
    after: approvalStartedAt,
    approvalWord: options.approvalWord,
    pollIntervalMs: options.pollIntervalMs,
    recipient,
    timeoutMs: options.timeoutMs,
  });
  console.log("");
  logKeyValue("approval", `${approval.text} from ${approval.handle}`);

  if (!options.skipDryRun) {
    logSection("Dry Run");

    const { data, response } = await requestJson(
      "POST",
      `${baseUrl}/api/coinbase/agentic-payments`,
      {
        checkoutId: checkout.id,
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

  logSection("Execute Headless Payment");

  const { data: paymentData, response: paymentResponse } = await requestJson(
    "POST",
    `${baseUrl}/api/coinbase/agentic-payments`,
    {
      checkoutId: checkout.id,
      waitForCompletion: true,
    },
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

  logSection("Result");

  if (paymentData.attempt.stage === "completed") {
    console.log("iMessage-approved payment completed.");
    return;
  }

  process.exitCode = 1;
  console.error("Payment was submitted but did not finish in completed state.");
}

main().catch((error) => {
  console.error("\niMessage payment demo failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
