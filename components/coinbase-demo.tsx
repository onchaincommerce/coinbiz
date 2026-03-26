"use client";

import { startTransition, useEffect, useEffectEvent, useState } from "react";

import type {
  CheckoutEnvironment,
  CoinbaseCheckout,
  DemoEventRecord,
  DemoStatePayload,
} from "@/app/lib/coinbase-types";

type CoinbaseDemoProps = {
  initialState: DemoStatePayload;
};

type FlowMode = "cart" | "donation";

type CreateCheckoutResponse = {
  checkout: CoinbaseCheckout;
  demoState: DemoStatePayload;
};

type CartItem = {
  caption: string;
  id: string;
  quantity: number;
  title: string;
  unitAmount: number;
};

const environmentLabels: Record<CheckoutEnvironment, string> = {
  live: "Live",
  sandbox: "Sandbox",
};

const donationPresets = ["10", "25", "50", "100"];

const starterCart: CartItem[] = [
  {
    caption: "A concise product-style checkout to demo line items.",
    id: "starter-kit",
    quantity: 1,
    title: "Checkout starter kit",
    unitAmount: 49,
  },
  {
    caption: "A compact add-on to show quantity controls and metadata.",
    id: "webhook-feed",
    quantity: 0,
    title: "Webhook feed add-on",
    unitAmount: 18,
  },
  {
    caption: "A small support item to show mixed totals cleanly.",
    id: "donation-boost",
    quantity: 0,
    title: "Builder support boost",
    unitAmount: 12,
  },
];

const statusStyles: Record<string, string> = {
  ACTIVE: "bg-[#e5edff] text-[#3155c4]",
  COMPLETED: "bg-[#e8f7f3] text-[#1b7f63]",
  DEACTIVATED: "bg-[#edf1f7] text-[#55627a]",
  EXPIRED: "bg-[#fff1dd] text-[#99631a]",
  FAILED: "bg-[#ffe9e7] text-[#a44038]",
  PROCESSING: "bg-[#e9f0ff] text-[#345ecc]",
};

function formatTimestamp(value?: string | null) {
  if (!value) {
    return "Waiting for activity";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatAmount(value: number) {
  return `${value.toFixed(2)} USDC`;
}

function getStatusStyle(status: string) {
  return statusStyles[status] ?? "bg-[#efefea] text-[#4a4a45]";
}

function buildCartMetadata(
  items: CartItem[],
  reference: string,
  note: string,
): Record<string, string> {
  const selectedItems = items.filter((item) => item.quantity > 0);

  return {
    itemCount: String(
      selectedItems.reduce((total, item) => total + item.quantity, 0),
    ),
    mode: "cart",
    note: note.trim(),
    reference: reference.trim() || `ord-${Date.now()}`,
    summary: selectedItems
      .map((item) => `${item.id}:${item.quantity}`)
      .join("|")
      .slice(0, 180),
  };
}

function buildDonationMetadata(
  amount: string,
  reference: string,
  supporterName: string,
  note: string,
): Record<string, string> {
  return {
    amount: amount.trim(),
    donor: supporterName.trim(),
    mode: "donation",
    note: note.trim(),
    reference: reference.trim() || `don-${Date.now()}`,
  };
}

function getCartTotal(items: CartItem[]) {
  return items.reduce(
    (total, item) => total + item.unitAmount * Math.max(item.quantity, 0),
    0,
  );
}

function EventFeed({ events }: { events: DemoEventRecord[] }) {
  if (events.length === 0) {
    return (
      <div className="rounded-[1.5rem] border border-dashed border-[var(--line)] px-4 py-5 text-sm leading-7 text-[var(--ink-soft)]">
        No webhook events yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {events.slice(0, 5).map((event) => (
        <article
          key={event.id}
          className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 px-4 py-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[var(--foreground)]">
                {event.title}
              </p>
              <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">
                {event.message}
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${getStatusStyle(event.status)}`}
            >
              {event.status}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-[var(--ink-soft)]">
            <span>{environmentLabels[event.environment]}</span>
            <span>•</span>
            <span>{event.amount}</span>
            <span>•</span>
            <span>{formatTimestamp(event.occurredAt)}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

export function CoinbaseDemo({ initialState }: CoinbaseDemoProps) {
  const [flowMode, setFlowMode] = useState<FlowMode>("cart");
  const [environment, setEnvironment] = useState<CheckoutEnvironment>("sandbox");
  const [cartItems, setCartItems] = useState(starterCart);
  const [donationAmount, setDonationAmount] = useState("25");
  const [reference, setReference] = useState("coinbiz-1001");
  const [supporterName, setSupporterName] = useState("");
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [eventStreamStatus, setEventStreamStatus] = useState("connecting");
  const [origin, setOrigin] = useState("");
  const [demoState, setDemoState] = useState(initialState);
  const [activeCheckout, setActiveCheckout] = useState<CoinbaseCheckout | null>(
    initialState.checkouts[0] ?? null,
  );

  const cartTotal = getCartTotal(cartItems);
  const donationValue = Number.parseFloat(donationAmount || "0");
  const totalAmount = flowMode === "cart" ? cartTotal : donationValue;
  const isValidAmount = Number.isFinite(totalAmount) && totalAmount > 0;
  const webhookUrl = `${origin}${demoState.webhookPaths[environment]}`;
  const redirectBaseUrl = origin.startsWith("https://") ? origin : "";
  const metadata =
    flowMode === "cart"
      ? buildCartMetadata(cartItems, reference, note)
      : buildDonationMetadata(donationAmount, reference, supporterName, note);
  const checkoutDescription =
    flowMode === "cart"
      ? `Coinbiz cart • ${cartItems.filter((item) => item.quantity > 0).length} items`
      : "Coinbiz donation";

  function openHostedCheckout(url: string) {
    window.location.assign(url);
  }

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!activeCheckout?.demoEnvironment) {
      return;
    }

    const refreshedCheckout = demoState.checkouts.find(
      (checkout) =>
        checkout.id === activeCheckout.id &&
        checkout.demoEnvironment === activeCheckout.demoEnvironment,
    );

    if (refreshedCheckout) {
      setActiveCheckout(refreshedCheckout);
    }
  }, [activeCheckout, demoState.checkouts]);

  const applyStreamState = useEffectEvent((nextState: DemoStatePayload) => {
    startTransition(() => {
      setDemoState(nextState);
    });
  });

  useEffect(() => {
    const eventSource = new EventSource("/api/coinbase/events");
    const handleSnapshot: EventListener = (event) => {
      const messageEvent = event as MessageEvent<string>;
      applyStreamState(JSON.parse(messageEvent.data) as DemoStatePayload);
      setEventStreamStatus("live");
    };
    const handleUpdate: EventListener = (event) => {
      const messageEvent = event as MessageEvent<string>;
      applyStreamState(JSON.parse(messageEvent.data) as DemoStatePayload);
      setEventStreamStatus("live");
    };

    eventSource.addEventListener("open", () => {
      setEventStreamStatus("live");
    });
    eventSource.addEventListener("snapshot", handleSnapshot);
    eventSource.addEventListener("update", handleUpdate);

    eventSource.onerror = () => {
      setEventStreamStatus("reconnecting");
    };

    return () => {
      eventSource.removeEventListener("snapshot", handleSnapshot);
      eventSource.removeEventListener("update", handleUpdate);
      eventSource.close();
    };
  }, []);

  function updateQuantity(itemId: string, delta: number) {
    setCartItems((currentItems) =>
      currentItems.map((item) =>
        item.id === itemId
          ? { ...item, quantity: Math.max(item.quantity + delta, 0) }
          : item,
      ),
    );
  }

  async function handleCreateCheckout() {
    if (!isValidAmount) {
      setErrorMessage("Choose a donation amount or add at least one cart item.");
      return;
    }

    try {
      setCreating(true);
      setErrorMessage(null);

      const response = await fetch("/api/coinbase/checkouts", {
        body: JSON.stringify({
          amount: totalAmount.toFixed(2),
          description: checkoutDescription,
          environment,
          failRedirectUrl: redirectBaseUrl
            ? `${redirectBaseUrl}/payment-result?environment=${environment}&status=failed`
            : undefined,
          metadata,
          successRedirectUrl: redirectBaseUrl
            ? `${redirectBaseUrl}/payment-result?environment=${environment}&status=success`
            : undefined,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      const data = (await response.json()) as
        | CreateCheckoutResponse
        | { error?: string };

      if (!response.ok || !("checkout" in data)) {
        throw new Error(data.error ?? "Unable to create checkout.");
      }

      setActiveCheckout(data.checkout);
      startTransition(() => {
        setDemoState(data.demoState);
      });
      openHostedCheckout(data.checkout.url);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to create checkout.";
      setErrorMessage(message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-8 lg:px-10 lg:py-12">
      <header className="border-b border-[var(--line)] pb-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="eyebrow">Coinbase Business</p>
            <h1 className="display-font mt-4 text-4xl font-semibold tracking-[-0.04em] sm:text-[4.25rem] sm:leading-none">
              Coinbase Business API Demo
            </h1>
            <p className="muted-copy mt-4 max-w-2xl text-base leading-8 sm:text-lg">
              Sandbox and live hosted checkouts with a webhook server feed.
            </p>
          </div>

          <div className="flex flex-col items-start gap-3 lg:items-end">
            <div className="inline-flex rounded-full border border-[var(--line)] bg-white/80 p-1">
              {(["sandbox", "live"] as CheckoutEnvironment[]).map((value) => (
                <button
                  key={value}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    environment === value
                      ? "bg-[var(--accent-strong)] text-white soft-ring"
                      : "text-[var(--ink-soft)] hover:text-[var(--foreground)]"
                  }`}
                  onClick={() => setEnvironment(value)}
                  type="button"
                >
                  {environmentLabels[value]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <section className="mt-10 grid gap-8 lg:grid-cols-[1.08fr_0.92fr]">
        <div className="glass-panel p-7 sm:p-9">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Checkout</p>
              <h2 className="display-font mt-3 text-3xl font-semibold tracking-[-0.03em]">
                {flowMode === "cart" ? "Cart" : "Donation"}
              </h2>
            </div>
            <div className="inline-flex rounded-full border border-[var(--line)] bg-white p-1">
              {(["cart", "donation"] as FlowMode[]).map((value) => (
                <button
                  key={value}
                  className={`rounded-full px-4 py-2 text-sm font-semibold capitalize transition ${
                    flowMode === value
                      ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                      : "text-[var(--ink-soft)] hover:text-[var(--foreground)]"
                  }`}
                  onClick={() => setFlowMode(value)}
                  type="button"
                >
                  {value}
                </button>
              ))}
            </div>
          </div>

          {flowMode === "cart" ? (
            <div className="mt-8 divide-y divide-[var(--line)]">
              {cartItems.map((item) => (
                <article
                  key={item.id}
                  className="py-5 first:pt-0 last:pb-0"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-base font-semibold">{item.title}</p>
                    </div>
                    <p className="text-sm font-semibold text-[var(--ink-soft)]">
                      {formatAmount(item.unitAmount)}
                    </p>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <div className="inline-flex items-center rounded-full border border-[var(--line)] bg-white p-1">
                      <button
                        className="h-9 w-9 rounded-full text-lg text-[var(--foreground)] transition hover:bg-white"
                        onClick={() => updateQuantity(item.id, -1)}
                        type="button"
                      >
                        -
                      </button>
                      <span className="min-w-12 text-center text-sm font-semibold">
                        {item.quantity}
                      </span>
                      <button
                        className="h-9 w-9 rounded-full text-lg text-[var(--foreground)] transition hover:bg-white"
                        onClick={() => updateQuantity(item.id, 1)}
                        type="button"
                      >
                        +
                      </button>
                    </div>
                    <p className="text-sm font-semibold">
                      {formatAmount(item.quantity * item.unitAmount)}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="mt-7 space-y-5">
              <div className="flex flex-wrap gap-3">
                {donationPresets.map((preset) => (
                  <button
                    key={preset}
                    className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                      donationAmount === preset
                        ? "border-[var(--accent-strong)] bg-[var(--accent-strong)] text-white shadow-[0_10px_35px_rgba(54,103,255,0.24)]"
                        : "border-[var(--line)] bg-white text-[var(--foreground)] hover:border-[var(--foreground)]"
                    }`}
                    onClick={() => setDonationAmount(preset)}
                    type="button"
                  >
                    {preset}.00 USDC
                  </button>
                ))}
              </div>
              <label className="block space-y-2">
                <span className="text-sm font-semibold">Custom donation amount</span>
                <input
                  className="w-full rounded-[1.25rem] border border-[var(--line)] bg-white px-4 py-3 text-sm outline-none transition focus:border-[var(--accent)]"
                  onChange={(event) => setDonationAmount(event.target.value)}
                  placeholder="25"
                  value={donationAmount}
                />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-semibold">Supporter name</span>
                <input
                  className="w-full rounded-[1.25rem] border border-[var(--line)] bg-white px-4 py-3 text-sm outline-none transition focus:border-[var(--accent)]"
                  onChange={(event) => setSupporterName(event.target.value)}
                  placeholder="Optional"
                  value={supporterName}
                />
              </label>
            </div>
          )}

          <div className="mt-8 grid gap-4 md:grid-cols-2">
            <label className="block space-y-2">
              <span className="text-sm font-semibold">Reference</span>
              <input
                className="w-full rounded-[1.25rem] border border-[var(--line)] bg-white px-4 py-3 text-sm outline-none transition focus:border-[var(--accent)]"
                onChange={(event) => setReference(event.target.value)}
                value={reference}
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-semibold">Internal note</span>
              <input
                className="w-full rounded-[1.25rem] border border-[var(--line)] bg-white px-4 py-3 text-sm outline-none transition focus:border-[var(--accent)]"
                onChange={(event) => setNote(event.target.value)}
                placeholder="Optional"
                value={note}
              />
            </label>
          </div>

          <div className="mt-8 border-t border-[var(--line)] pt-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--ink-soft)]">
                  Total
                </p>
                <p className="mt-2 text-3xl font-semibold tracking-[-0.03em]">
                  {isValidAmount ? formatAmount(totalAmount) : "0.00 USDC"}
                </p>
              </div>
              <button
                className="rounded-full bg-[var(--accent-strong)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent)] hover:shadow-[0_14px_44px_rgba(54,103,255,0.28)] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!demoState.credentialsConfigured || creating || !isValidAmount}
                onClick={handleCreateCheckout}
                type="button"
              >
                {creating ? "Creating..." : "Create checkout"}
              </button>
            </div>
          </div>

          {errorMessage ? (
            <div className="mt-5 rounded-[1.25rem] border border-[#efc8c3] bg-[#fbefed] px-4 py-3 text-sm leading-6 text-[#8f352d]">
              {errorMessage}
            </div>
          ) : null}
        </div>

        <aside className="glass-panel p-6 sm:p-7">
          <div className="space-y-6">
            <section className="border-b border-[var(--line)] pb-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="eyebrow">Current Checkout</p>
                  <h2 className="display-font mt-3 text-2xl font-semibold tracking-[-0.03em]">
                    Hosted checkout
                  </h2>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
                    activeCheckout
                      ? getStatusStyle(activeCheckout.status)
                      : "bg-[#efefea] text-[#4a4a45]"
                  }`}
                >
                  {activeCheckout?.status ?? "Waiting"}
                </span>
              </div>

              {activeCheckout ? (
                <>
                  <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-[var(--ink-soft)]">
                    <span>{activeCheckout.amount} {activeCheckout.currency}</span>
                    <span>•</span>
                    <span>
                      {environmentLabels[
                        activeCheckout.demoEnvironment ?? environment
                      ]}
                    </span>
                    <span>•</span>
                    <span>{activeCheckout.network}</span>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-3">
                    <button
                      className="rounded-full bg-[var(--accent-strong)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent)] hover:shadow-[0_14px_44px_rgba(54,103,255,0.28)]"
                      onClick={() => openHostedCheckout(activeCheckout.url)}
                      type="button"
                    >
                      Open hosted checkout
                    </button>
                    <span className="rounded-full border border-[var(--line)] px-4 py-3 text-sm text-[var(--ink-soft)]">
                      {activeCheckout.id}
                    </span>
                  </div>
                </>
              ) : (
                <div className="mt-5 text-sm leading-7 text-[var(--ink-soft)]">
                  Create a checkout and the latest Coinbase payment link will appear
                  here.
                </div>
              )}
            </section>

            <section className="border-b border-[var(--line)] pb-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="eyebrow">Webhook Server Feed</p>
                  <h2 className="display-font mt-3 text-2xl font-semibold tracking-[-0.03em]">
                    Events
                  </h2>
                </div>
                <span className="rounded-full border border-[var(--line)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                  {eventStreamStatus}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-soft)]">
                <span className="rounded-full border border-[var(--line)] px-3 py-2">
                  {webhookUrl || demoState.webhookPaths[environment]}
                </span>
                <span className="rounded-full border border-[var(--line)] px-3 py-2">
                  {demoState.webhookSecretsConfigured[environment]
                    ? "secret configured"
                    : "secret pending"}
                </span>
              </div>

              <div className="mt-5">
                <EventFeed events={demoState.events} />
              </div>
            </section>
          </div>
        </aside>
      </section>
    </main>
  );
}
