import crypto from "node:crypto";

import {
  areCoinbaseCredentialsConfigured,
  getDemoConfig,
  listCheckouts,
} from "@/app/lib/coinbase";
import type {
  CheckoutEnvironment,
  CoinbaseCheckout,
  DemoEventRecord,
  DemoStatePayload,
} from "@/app/lib/coinbase-types";

type DemoStore = {
  checkouts: Map<string, CoinbaseCheckout>;
  events: DemoEventRecord[];
  lastUpdatedAt: string | null;
  listeners: Set<(state: DemoStatePayload) => void>;
};

type UpdateCheckoutOptions = {
  emit?: boolean;
  event?: DemoEventRecord;
  markUpdated?: boolean;
};

const REMOTE_HISTORY_LIMIT = 8;
const MAX_EVENT_COUNT = 32;

const globalForDemoStore = globalThis as typeof globalThis & {
  __coinbaseBusinessDemoStore?: DemoStore;
};

function buildCheckoutKey(environment: CheckoutEnvironment, checkoutId: string) {
  return `${environment}:${checkoutId}`;
}

function buildEventKey(event: DemoEventRecord) {
  return `${event.environment}:${event.checkoutId}:${event.status}`;
}

function ensureStore() {
  if (!globalForDemoStore.__coinbaseBusinessDemoStore) {
    globalForDemoStore.__coinbaseBusinessDemoStore = {
      checkouts: new Map(),
      events: [],
      lastUpdatedAt: null,
      listeners: new Set(),
    };
  }

  return globalForDemoStore.__coinbaseBusinessDemoStore;
}

function sortCheckouts(checkouts: CoinbaseCheckout[]) {
  return [...checkouts].sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt ?? left.createdAt ?? "0");
    const rightTime = Date.parse(right.updatedAt ?? right.createdAt ?? "0");
    return rightTime - leftTime;
  });
}

function sortEvents(events: DemoEventRecord[]) {
  return [...events].sort((left, right) => {
    const leftTime = Date.parse(left.occurredAt ?? "0");
    const rightTime = Date.parse(right.occurredAt ?? "0");
    return rightTime - leftTime;
  });
}

function createWebhookEvent(
  environment: CheckoutEnvironment,
  checkout: CoinbaseCheckout,
): DemoEventRecord {
  const eventLabel = checkout.eventType ?? "checkout update";
  const statusLabel = checkout.status.toLowerCase();

  return {
    amount: checkout.amount,
    checkoutId: checkout.id,
    environment,
    id: crypto.randomUUID(),
    message: `${eventLabel} moved checkout ${checkout.id} to ${statusLabel}.`,
    occurredAt: new Date().toISOString(),
    status: checkout.status,
    title: `${environment === "sandbox" ? "Sandbox" : "Live"} webhook received`,
  };
}

function createHistoryEvent(
  environment: CheckoutEnvironment,
  checkout: CoinbaseCheckout,
): DemoEventRecord {
  const statusLabel = checkout.status.toLowerCase();

  return {
    amount: checkout.amount,
    checkoutId: checkout.id,
    environment,
    id: `${environment}-${checkout.id}-${checkout.status}`,
    message: `Checkout ${checkout.id} is ${statusLabel}.`,
    occurredAt:
      checkout.updatedAt ?? checkout.createdAt ?? new Date().toISOString(),
    status: checkout.status,
    title: `${environment === "sandbox" ? "Sandbox" : "Live"} checkout activity`,
  };
}

function upsertCheckout(
  environment: CheckoutEnvironment,
  checkout: CoinbaseCheckout,
  options: UpdateCheckoutOptions = {},
) {
  const store = ensureStore();
  const checkoutWithEnvironment = {
    ...checkout,
    demoEnvironment: environment,
  };

  store.checkouts.set(
    buildCheckoutKey(environment, checkout.id),
    checkoutWithEnvironment,
  );

  if (options.event) {
    store.events = [options.event, ...store.events].slice(0, MAX_EVENT_COUNT);
  }

  if (options.markUpdated) {
    store.lastUpdatedAt = new Date().toISOString();
  }

  if (options.emit) {
    emitDemoState();
  }
}

function buildActivityEvents(
  checkouts: CoinbaseCheckout[],
  webhookEvents: DemoEventRecord[],
) {
  const mergedEvents = new Map<string, DemoEventRecord>();

  for (const event of sortEvents(webhookEvents)) {
    if (!event.title.toLowerCase().includes("webhook")) {
      continue;
    }

    mergedEvents.set(buildEventKey(event), event);
  }

  for (const checkout of checkouts.slice(0, MAX_EVENT_COUNT)) {
    const environment = checkout.demoEnvironment;

    if (!environment) {
      continue;
    }

    const historyEvent = createHistoryEvent(environment, checkout);
    const eventKey = buildEventKey(historyEvent);

    if (!mergedEvents.has(eventKey)) {
      mergedEvents.set(eventKey, historyEvent);
    }
  }

  return sortEvents([...mergedEvents.values()]).slice(0, MAX_EVENT_COUNT);
}

export function recordCheckoutCreated(
  environment: CheckoutEnvironment,
  checkout: CoinbaseCheckout,
) {
  upsertCheckout(environment, checkout, { emit: true, markUpdated: true });
}

export function recordCheckoutWebhook(
  environment: CheckoutEnvironment,
  checkout: CoinbaseCheckout,
) {
  upsertCheckout(environment, checkout, {
    emit: true,
    event: createWebhookEvent(environment, checkout),
    markUpdated: true,
  });
}

export function hydrateCheckout(
  environment: CheckoutEnvironment,
  checkout: CoinbaseCheckout,
) {
  upsertCheckout(environment, checkout, { emit: true, markUpdated: true });
}

export async function syncRemoteCheckouts() {
  if (!areCoinbaseCredentialsConfigured()) {
    return getDemoState();
  }

  const store = ensureStore();
  const previousUpdatedAt = store.lastUpdatedAt;
  const [sandboxResult, liveResult] = await Promise.allSettled([
    listCheckouts({
      environment: "sandbox",
      pageSize: REMOTE_HISTORY_LIMIT,
    }),
    listCheckouts({
      environment: "live",
      pageSize: REMOTE_HISTORY_LIMIT,
    }),
  ]);

  if (sandboxResult.status === "fulfilled") {
    for (const checkout of sandboxResult.value.checkouts) {
      upsertCheckout("sandbox", checkout);
    }
  }

  if (liveResult.status === "fulfilled") {
    for (const checkout of liveResult.value.checkouts) {
      upsertCheckout("live", checkout);
    }
  }

  if (
    (sandboxResult.status === "fulfilled" && sandboxResult.value.checkouts.length > 0) ||
    (liveResult.status === "fulfilled" && liveResult.value.checkouts.length > 0)
  ) {
    store.lastUpdatedAt = new Date().toISOString();
  } else {
    store.lastUpdatedAt = previousUpdatedAt;
  }

  emitDemoState();

  return getDemoState();
}

export function getDemoState(): DemoStatePayload {
  const store = ensureStore();
  const checkouts = sortCheckouts([...store.checkouts.values()]);

  return {
    checkouts,
    ...getDemoConfig(),
    events: buildActivityEvents(checkouts, store.events),
    lastUpdatedAt: store.lastUpdatedAt,
  };
}

function emitDemoState() {
  const state = getDemoState();
  const store = ensureStore();

  for (const listener of store.listeners) {
    listener(state);
  }
}

export function subscribeToDemoState(listener: (state: DemoStatePayload) => void) {
  const store = ensureStore();
  store.listeners.add(listener);

  return () => {
    store.listeners.delete(listener);
  };
}
