import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AgentCheckoutPaymentAttempt } from "@/app/lib/agentic-payment-types";
import type {
  CheckoutEnvironment,
  CoinbaseCheckout,
} from "@/app/lib/coinbase-types";
import { getPostgresSql, isPostgresConfigured } from "@/app/lib/postgres";

type AttemptStoreFile = {
  attempts: AgentCheckoutPaymentAttempt[];
};

const STORE_DIRECTORY =
  process.env.AGENTIC_PAYMENT_STORE_DIRECTORY?.trim() ||
  (process.env.VERCEL
    ? path.join(os.tmpdir(), "coinbiz")
    : path.join(process.cwd(), ".data"));
const STORE_PATH = path.join(STORE_DIRECTORY, "agentic-payment-attempts.json");

let postgresSetupPromise: Promise<void> | null = null;
let storeQueue = Promise.resolve<void>(undefined);

function cloneForStorage<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, entryValue) =>
      typeof entryValue === "bigint" ? entryValue.toString() : entryValue,
    ),
  ) as T;
}

async function ensureStoreDirectory() {
  await fs.mkdir(STORE_DIRECTORY, { recursive: true });
}

async function ensurePostgresAttemptTable() {
  if (!postgresSetupPromise) {
    postgresSetupPromise = (async () => {
      const sql = getPostgresSql();

      await sql`
        create table if not exists coinbase_agentic_payment_attempts (
          id text primary key,
          checkout_id text not null,
          payload jsonb not null,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `;
      await sql`
        create index if not exists coinbase_agentic_payment_attempts_checkout_idx
          on coinbase_agentic_payment_attempts (checkout_id, updated_at desc)
      `;
    })();
  }

  try {
    return await postgresSetupPromise;
  } catch (error) {
    postgresSetupPromise = null;
    throw error;
  }
}

function parseAttemptPayload(payload: unknown): AgentCheckoutPaymentAttempt | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const attempt = cloneForStorage(payload) as Partial<AgentCheckoutPaymentAttempt>;

  return typeof attempt.id === "string" && typeof attempt.checkoutId === "string"
    ? (attempt as AgentCheckoutPaymentAttempt)
    : null;
}

async function readPostgresAttempts() {
  await ensurePostgresAttemptTable();

  const sql = getPostgresSql();
  const result = await sql`
    select payload
    from coinbase_agentic_payment_attempts
    order by updated_at desc
  ` as Array<{ payload: unknown }>;

  return result
    .map((row) => parseAttemptPayload(row.payload))
    .filter((attempt): attempt is AgentCheckoutPaymentAttempt => Boolean(attempt));
}

async function readPostgresAttemptById(id: string) {
  await ensurePostgresAttemptTable();

  const sql = getPostgresSql();
  const result = await sql`
    select payload
    from coinbase_agentic_payment_attempts
    where id = ${id}
    limit 1
  ` as Array<{ payload: unknown }>;

  return parseAttemptPayload(result[0]?.payload) ?? undefined;
}

async function readLatestPostgresAttemptByCheckoutId(checkoutId: string) {
  await ensurePostgresAttemptTable();

  const sql = getPostgresSql();
  const result = await sql`
    select payload
    from coinbase_agentic_payment_attempts
    where checkout_id = ${checkoutId}
    order by updated_at desc
    limit 1
  ` as Array<{ payload: unknown }>;

  return parseAttemptPayload(result[0]?.payload) ?? undefined;
}

async function upsertPostgresAttempt(attempt: AgentCheckoutPaymentAttempt) {
  await ensurePostgresAttemptTable();

  const sql = getPostgresSql();
  const nextAttempt = cloneForStorage(attempt);
  await sql`
    insert into coinbase_agentic_payment_attempts (
      id,
      checkout_id,
      payload,
      updated_at
    )
    values (
      ${nextAttempt.id},
      ${nextAttempt.checkoutId},
      ${JSON.stringify(nextAttempt)}::jsonb,
      ${nextAttempt.updatedAt}::timestamptz
    )
    on conflict (id) do update set
      checkout_id = excluded.checkout_id,
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `;

  return nextAttempt;
}

function logPostgresFallback(operation: string, error: unknown) {
  console.error(
    `Agentic payment ${operation} failed against Postgres; falling back to ephemeral local storage.`,
    error,
  );
}

async function readStoreFile(): Promise<AttemptStoreFile> {
  await ensureStoreDirectory();

  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AttemptStoreFile>;

    return {
      attempts: Array.isArray(parsed.attempts)
        ? parsed.attempts.map((attempt) => cloneForStorage(attempt))
        : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { attempts: [] };
    }

    throw error;
  }
}

async function writeStoreFile(store: AttemptStoreFile) {
  await ensureStoreDirectory();

  const temporaryPath = `${STORE_PATH}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(
    temporaryPath,
    JSON.stringify(cloneForStorage(store), null, 2),
    "utf8",
  );
  await fs.rename(temporaryPath, STORE_PATH);
}

async function withStoreLock<T>(callback: (store: AttemptStoreFile) => Promise<T> | T) {
  const scheduled = storeQueue.then(async () => {
    const store = await readStoreFile();
    const result = await callback(store);
    await writeStoreFile(store);
    return result;
  });

  storeQueue = scheduled.then(
    () => undefined,
    () => undefined,
  );

  return scheduled;
}

export async function listAgentCheckoutPaymentAttempts() {
  let attempts: AgentCheckoutPaymentAttempt[];

  if (isPostgresConfigured()) {
    try {
      attempts = await readPostgresAttempts();
    } catch (error) {
      logPostgresFallback("list", error);
      attempts = (await readStoreFile()).attempts;
    }
  } else {
    attempts = (await readStoreFile()).attempts;
  }

  return [...attempts].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt ?? left.createdAt);
    const rightTime = Date.parse(right.updatedAt ?? right.createdAt);
    return rightTime - leftTime;
  });
}

export async function getAgentCheckoutPaymentAttemptById(id: string) {
  if (isPostgresConfigured()) {
    try {
      return await readPostgresAttemptById(id);
    } catch (error) {
      logPostgresFallback("read by id", error);
    }
  }

  const store = await readStoreFile();
  return store.attempts.find((attempt) => attempt.id === id);
}

export async function getLatestAgentCheckoutPaymentAttemptByCheckoutId(
  checkoutId: string,
) {
  if (isPostgresConfigured()) {
    try {
      return await readLatestPostgresAttemptByCheckoutId(checkoutId);
    } catch (error) {
      logPostgresFallback("read by checkout id", error);
    }
  }

  const attempts = await listAgentCheckoutPaymentAttempts();
  return attempts.find((attempt) => attempt.checkoutId === checkoutId);
}

export async function upsertAgentCheckoutPaymentAttempt(
  attempt: AgentCheckoutPaymentAttempt,
) {
  if (isPostgresConfigured()) {
    try {
      return await upsertPostgresAttempt(attempt);
    } catch (error) {
      logPostgresFallback("upsert", error);
    }
  }

  return withStoreLock((store) => {
    const nextAttempt = cloneForStorage(attempt);
    const index = store.attempts.findIndex((entry) => entry.id === nextAttempt.id);

    if (index === -1) {
      store.attempts.unshift(nextAttempt);
    } else {
      store.attempts[index] = nextAttempt;
    }

    return nextAttempt;
  });
}

function getCheckoutWebhookStage(
  checkout: CoinbaseCheckout,
  existingStage: AgentCheckoutPaymentAttempt["stage"],
) {
  const status = checkout.status.toUpperCase();

  if (status === "COMPLETED") {
    return "completed";
  }

  if (["CANCELED", "CANCELLED", "EXPIRED", "FAILED"].includes(status)) {
    return "failed";
  }

  return existingStage;
}

export async function recordAgenticCheckoutWebhook(
  environment: CheckoutEnvironment,
  checkout: CoinbaseCheckout,
) {
  if (environment !== "live") {
    return null;
  }

  const existingAttempt = await getLatestAgentCheckoutPaymentAttemptByCheckoutId(
    checkout.id,
  );

  if (!existingAttempt) {
    return null;
  }

  const now = new Date().toISOString();
  const stage = getCheckoutWebhookStage(checkout, existingAttempt.stage);
  const isFailed = stage === "failed";

  return upsertAgentCheckoutPaymentAttempt({
    ...existingAttempt,
    errorCode: isFailed ? checkout.status : existingAttempt.errorCode,
    errorMessage: isFailed
      ? `Checkout finished in ${checkout.status}.`
      : existingAttempt.errorMessage,
    lastReconciledAt: now,
    rawCheckoutStatus: checkout,
    stage,
    txHash: checkout.transactionHash ?? existingAttempt.txHash,
    updatedAt: now,
  });
}
