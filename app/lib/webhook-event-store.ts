import crypto from "node:crypto";

import type {
  CheckoutEnvironment,
  CoinbaseCheckout,
} from "@/app/lib/coinbase-types";
import { getPostgresSql, isPostgresConfigured } from "@/app/lib/postgres";

type StoreWebhookEventInput = {
  checkout: CoinbaseCheckout;
  environment: CheckoutEnvironment;
  payload: unknown;
};

type StoreWebhookEventResult =
  | {
      reason: "postgres_unconfigured";
      stored: false;
    }
  | {
      stored: true;
    };

let setupPromise: Promise<void> | null = null;

function parseCheckoutPayload(payload: unknown): CoinbaseCheckout | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const checkout = payload as Partial<CoinbaseCheckout>;

  return typeof checkout.id === "string" ? (checkout as CoinbaseCheckout) : null;
}

async function ensureWebhookEventTable() {
  if (!setupPromise) {
    setupPromise = (async () => {
      const sql = getPostgresSql();

      await sql`
        create table if not exists coinbase_webhook_events (
          id uuid primary key,
          environment text not null check (environment in ('sandbox', 'live')),
          checkout_id text,
          event_type text,
          status text,
          tx_hash text,
          payload jsonb not null,
          received_at timestamptz not null default now()
        )
      `;
      await sql`
        create index if not exists coinbase_webhook_events_checkout_idx
          on coinbase_webhook_events (environment, checkout_id, received_at desc)
      `;
    })();
  }

  try {
    return await setupPromise;
  } catch (error) {
    setupPromise = null;
    throw error;
  }
}

export async function storeCoinbaseWebhookEvent({
  checkout,
  environment,
  payload,
}: StoreWebhookEventInput): Promise<StoreWebhookEventResult> {
  if (!isPostgresConfigured()) {
    console.warn(
      "Skipping Coinbase webhook event persistence because Vercel Postgres env vars are not configured.",
    );
    return {
      reason: "postgres_unconfigured",
      stored: false,
    };
  }

  await ensureWebhookEventTable();

  const sql = getPostgresSql();
  await sql`
    insert into coinbase_webhook_events (
      id,
      environment,
      checkout_id,
      event_type,
      status,
      tx_hash,
      payload
    )
    values (
      ${crypto.randomUUID()}::uuid,
      ${environment},
      ${checkout.id ?? null},
      ${checkout.eventType ?? null},
      ${checkout.status ?? null},
      ${checkout.transactionHash ?? null},
      ${JSON.stringify(payload)}::jsonb
    )
  `;

  return {
    stored: true,
  };
}

export async function getLatestCoinbaseWebhookCheckout(input: {
  checkoutId: string;
  environment: CheckoutEnvironment;
}) {
  if (!isPostgresConfigured()) {
    return null;
  }

  await ensureWebhookEventTable();

  const sql = getPostgresSql();
  const result = await sql`
    select payload
    from coinbase_webhook_events
    where environment = ${input.environment}
      and checkout_id = ${input.checkoutId}
    order by received_at desc
    limit 1
  ` as Array<{ payload: unknown }>;

  return parseCheckoutPayload(result[0]?.payload);
}

export async function listLatestCoinbaseWebhookCheckouts(input: {
  environment: CheckoutEnvironment;
}) {
  if (!isPostgresConfigured()) {
    return [];
  }

  await ensureWebhookEventTable();

  const sql = getPostgresSql();
  const result = await sql`
    select distinct on (checkout_id) payload
    from coinbase_webhook_events
    where environment = ${input.environment}
      and checkout_id is not null
    order by checkout_id, received_at desc
  ` as Array<{ payload: unknown }>;

  return result
    .map((row) => parseCheckoutPayload(row.payload))
    .filter((checkout): checkout is CoinbaseCheckout => Boolean(checkout));
}
