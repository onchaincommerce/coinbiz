import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AgentCheckout } from "@/app/lib/agent-checkout-types";
import { getPostgresSql, isPostgresConfigured } from "@/app/lib/postgres";

type AgentCheckoutStoreFile = {
  checkouts: AgentCheckout[];
};

const STORE_DIRECTORY =
  process.env.AGENT_CHECKOUT_STORE_DIRECTORY?.trim() ||
  (process.env.VERCEL
    ? path.join(os.tmpdir(), "coinbiz")
    : path.join(process.cwd(), ".data"));
const STORE_PATH = path.join(STORE_DIRECTORY, "agent-checkouts.json");

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

async function ensurePostgresAgentCheckoutTable() {
  if (!postgresSetupPromise) {
    postgresSetupPromise = (async () => {
      const sql = getPostgresSql();

      await sql`
        create table if not exists coinbase_agent_checkouts (
          id text primary key,
          payload jsonb not null,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `;
      await sql`
        create index if not exists coinbase_agent_checkouts_updated_idx
          on coinbase_agent_checkouts (updated_at desc)
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

function parseAgentCheckoutPayload(payload: unknown): AgentCheckout | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const checkout = cloneForStorage(payload) as Partial<AgentCheckout>;

  return typeof checkout.id === "string" && typeof checkout.amountUsdc === "string"
    ? (checkout as AgentCheckout)
    : null;
}

async function readPostgresAgentCheckout(id: string) {
  await ensurePostgresAgentCheckoutTable();

  const sql = getPostgresSql();
  const result = await sql`
    select payload
    from coinbase_agent_checkouts
    where id = ${id}
    limit 1
  ` as Array<{ payload: unknown }>;

  return parseAgentCheckoutPayload(result[0]?.payload) ?? undefined;
}

async function listPostgresAgentCheckouts() {
  await ensurePostgresAgentCheckoutTable();

  const sql = getPostgresSql();
  const result = await sql`
    select payload
    from coinbase_agent_checkouts
    order by updated_at desc
  ` as Array<{ payload: unknown }>;

  return result
    .map((row) => parseAgentCheckoutPayload(row.payload))
    .filter((checkout): checkout is AgentCheckout => Boolean(checkout));
}

async function upsertPostgresAgentCheckout(checkout: AgentCheckout) {
  await ensurePostgresAgentCheckoutTable();

  const sql = getPostgresSql();
  const nextCheckout = cloneForStorage(checkout);
  await sql`
    insert into coinbase_agent_checkouts (
      id,
      payload,
      updated_at
    )
    values (
      ${nextCheckout.id},
      ${JSON.stringify(nextCheckout)}::jsonb,
      ${nextCheckout.updatedAt}::timestamptz
    )
    on conflict (id) do update set
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `;

  return nextCheckout;
}

function logPostgresFallback(operation: string, error: unknown) {
  console.error(
    `Agent checkout ${operation} failed against Postgres; falling back to local storage.`,
    error,
  );
}

async function readStoreFile(): Promise<AgentCheckoutStoreFile> {
  await ensureStoreDirectory();

  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AgentCheckoutStoreFile>;

    return {
      checkouts: Array.isArray(parsed.checkouts)
        ? parsed.checkouts.map((checkout) => cloneForStorage(checkout))
        : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { checkouts: [] };
    }

    throw error;
  }
}

async function writeStoreFile(store: AgentCheckoutStoreFile) {
  await ensureStoreDirectory();

  const temporaryPath = `${STORE_PATH}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(
    temporaryPath,
    JSON.stringify(cloneForStorage(store), null, 2),
    "utf8",
  );
  await fs.rename(temporaryPath, STORE_PATH);
}

async function withStoreLock<T>(
  callback: (store: AgentCheckoutStoreFile) => Promise<T> | T,
) {
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

export async function listAgentCheckouts() {
  let checkouts: AgentCheckout[];

  if (isPostgresConfigured()) {
    try {
      checkouts = await listPostgresAgentCheckouts();
    } catch (error) {
      logPostgresFallback("list", error);
      checkouts = (await readStoreFile()).checkouts;
    }
  } else {
    checkouts = (await readStoreFile()).checkouts;
  }

  return [...checkouts].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt ?? left.createdAt);
    const rightTime = Date.parse(right.updatedAt ?? right.createdAt);
    return rightTime - leftTime;
  });
}

export async function getAgentCheckoutById(id: string) {
  if (isPostgresConfigured()) {
    try {
      return await readPostgresAgentCheckout(id);
    } catch (error) {
      logPostgresFallback("read", error);
    }
  }

  const store = await readStoreFile();
  return store.checkouts.find((checkout) => checkout.id === id);
}

export async function upsertAgentCheckout(checkout: AgentCheckout) {
  if (isPostgresConfigured()) {
    try {
      return await upsertPostgresAgentCheckout(checkout);
    } catch (error) {
      logPostgresFallback("upsert", error);
    }
  }

  return withStoreLock((store) => {
    const nextCheckout = cloneForStorage(checkout);
    const index = store.checkouts.findIndex((entry) => entry.id === nextCheckout.id);

    if (index === -1) {
      store.checkouts.unshift(nextCheckout);
    } else {
      store.checkouts[index] = nextCheckout;
    }

    return nextCheckout;
  });
}
