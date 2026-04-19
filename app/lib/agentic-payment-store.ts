import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { AgentCheckoutPaymentAttempt } from "@/app/lib/agentic-payment-types";

type AttemptStoreFile = {
  attempts: AgentCheckoutPaymentAttempt[];
};

const STORE_DIRECTORY = path.join(process.cwd(), ".data");
const STORE_PATH = path.join(STORE_DIRECTORY, "agentic-payment-attempts.json");

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
  const store = await readStoreFile();

  return [...store.attempts].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt ?? left.createdAt);
    const rightTime = Date.parse(right.updatedAt ?? right.createdAt);
    return rightTime - leftTime;
  });
}

export async function getAgentCheckoutPaymentAttemptById(id: string) {
  const store = await readStoreFile();
  return store.attempts.find((attempt) => attempt.id === id);
}

export async function getLatestAgentCheckoutPaymentAttemptByCheckoutId(
  checkoutId: string,
) {
  const attempts = await listAgentCheckoutPaymentAttempts();
  return attempts.find((attempt) => attempt.checkoutId === checkoutId);
}

export async function upsertAgentCheckoutPaymentAttempt(
  attempt: AgentCheckoutPaymentAttempt,
) {
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
