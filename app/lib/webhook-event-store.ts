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
