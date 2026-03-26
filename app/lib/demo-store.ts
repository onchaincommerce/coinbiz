import crypto from "node:crypto";

import { getDemoConfig } from "@/app/lib/coinbase";
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

const globalForDemoStore = globalThis as typeof globalThis & {
  __coinbaseBusinessDemoStore?: DemoStore;
};

function buildCheckoutKey(environment: CheckoutEnvironment, checkoutId: string) {
  return `${environment}:${checkoutId}`;
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

function createEvent(
  environment: CheckoutEnvironment,
  checkout: CoinbaseCheckout,
  title: string,
  message: string,
): DemoEventRecord {
  return {
    amount: checkout.amount,
    checkoutId: checkout.id,
    environment,
    id: crypto.randomUUID(),
    message,
    occurredAt: new Date().toISOString(),
    status: checkout.status,
    title,
  };
}

function updateCheckout(
  environment: CheckoutEnvironment,
  checkout: CoinbaseCheckout,
  event?: DemoEventRecord,
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

  if (event) {
    store.events = [event, ...store.events].slice(0, 32);
  }

  store.lastUpdatedAt = new Date().toISOString();
  emitDemoState();
}

export function recordCheckoutCreated(
  environment: CheckoutEnvironment,
  checkout: CoinbaseCheckout,
) {
  updateCheckout(environment, checkout);
}

export function recordCheckoutWebhook(
  environment: CheckoutEnvironment,
  checkout: CoinbaseCheckout,
) {
  const eventLabel = checkout.eventType ?? "checkout update";
  const statusLabel = checkout.status.toLowerCase();

  updateCheckout(
    environment,
    checkout,
    createEvent(
      environment,
      checkout,
      `${environment === "sandbox" ? "Sandbox" : "Live"} webhook received`,
      `${eventLabel} moved checkout ${checkout.id} to ${statusLabel}.`,
    ),
  );
}

export function hydrateCheckout(
  environment: CheckoutEnvironment,
  checkout: CoinbaseCheckout,
) {
  updateCheckout(environment, checkout);
}

export function getDemoState(): DemoStatePayload {
  const store = ensureStore();
  const webhookEvents = store.events.filter((event) =>
    event.title.toLowerCase().includes("webhook"),
  );

  return {
    checkouts: sortCheckouts([...store.checkouts.values()]),
    ...getDemoConfig(),
    events: webhookEvents,
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
