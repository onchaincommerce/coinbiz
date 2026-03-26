import Link from "next/link";
import { cookies } from "next/headers";

import { getCheckout } from "@/app/lib/coinbase";
import type {
  CheckoutEnvironment,
  CoinbaseCheckout,
} from "@/app/lib/coinbase-types";
import {
  deserializeReceiptContext,
  getReceiptCookieName,
} from "@/app/lib/receipt-context";

type PaymentResultPageProps = {
  searchParams: Promise<{
    environment?: string;
    reference?: string;
    status?: string;
  }>;
};

const statusStyles: Record<string, string> = {
  ACTIVE: "bg-[#e5edff] text-[#3155c4]",
  COMPLETED: "bg-[#e8f7f3] text-[#1b7f63]",
  DEACTIVATED: "bg-[#edf1f7] text-[#55627a]",
  EXPIRED: "bg-[#fff1dd] text-[#99631a]",
  FAILED: "bg-[#ffe9e7] text-[#a44038]",
  PROCESSING: "bg-[#e9f0ff] text-[#345ecc]",
  SUCCESS: "bg-[#e8f7f3] text-[#1b7f63]",
};

function isEnvironment(value?: string): value is CheckoutEnvironment {
  return value === "sandbox" || value === "live";
}

function getStatusStyle(status: string) {
  return statusStyles[status] ?? "bg-[#efefea] text-[#4a4a45]";
}

function getStatusCopy(status?: string) {
  if (status === "success") {
    return {
      body: "Coinbase redirected back after payment. This receipt pulls the latest checkout details available for the transaction.",
      title: "Payment receipt",
    };
  }

  if (status === "failed") {
    return {
      body: "Coinbase redirected back with a failed payment state. Review the receipt details below and try the hosted checkout again if needed.",
      title: "Payment update",
    };
  }

  return {
    body: "This route is ready to render a formal Coinbase Business receipt whenever a hosted checkout returns here.",
    title: "Receipt preview",
  };
}

function formatLabel(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatTimestamp(value?: string) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function maskIdentifier(value?: string, fallback = "Not available") {
  if (!value) {
    return fallback;
  }

  return value;
}

function ReceiptRow({
  href,
  label,
  mono = false,
  value,
}: {
  href?: string;
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div className="grid gap-2 border-b border-[var(--line)] py-4 first:pt-0 last:border-b-0 last:pb-0 sm:grid-cols-[180px_1fr] sm:gap-4">
      <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-soft)]">
        {label}
      </dt>
      <dd
        className={`text-sm leading-7 text-[var(--foreground)] ${mono ? "font-mono break-all text-[13px]" : ""}`}
      >
        {href ? (
          <a
            className="text-[var(--accent-strong)] underline decoration-[rgba(54,103,255,0.28)] underline-offset-4 transition hover:text-[var(--accent)]"
            href={href}
            rel="noreferrer"
            target="_blank"
          >
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}

export default async function PaymentResultPage({
  searchParams,
}: PaymentResultPageProps) {
  const { environment: environmentParam, reference, status } = await searchParams;
  const environment = isEnvironment(environmentParam) ? environmentParam : null;
  const copy = getStatusCopy(status);
  const cookieStore = await cookies();
  const storedReceipt = environment
    ? deserializeReceiptContext(
        cookieStore.get(getReceiptCookieName(environment))?.value,
      )
    : null;

  let checkout: CoinbaseCheckout | null = null;
  let checkoutError: string | null = null;

  if (environment && storedReceipt?.checkoutId) {
    try {
      checkout = await getCheckout(storedReceipt.checkoutId, environment);
    } catch (error) {
      checkoutError =
        error instanceof Error
          ? error.message
          : "Unable to load the latest Coinbase checkout details.";
    }
  }

  const metadata = checkout?.metadata ?? storedReceipt?.metadata ?? {};
  const metadataEntries = Object.entries(metadata);
  const displayStatus = checkout?.status ?? status?.toUpperCase() ?? "PENDING";
  const amountValue =
    checkout && checkout.currency
      ? `${checkout.amount} ${checkout.currency}`
      : storedReceipt
        ? `${storedReceipt.amount} ${storedReceipt.currency}`
        : "Not available";
  const checkoutId = checkout?.id ?? storedReceipt?.checkoutId ?? "Not available";
  const checkoutUrl = checkout?.url ?? storedReceipt?.checkoutUrl ?? "";
  const walletAddress = checkout?.address ?? "Not yet available";
  const receiptReference = metadata.reference ?? reference ?? "Not provided";
  const noteValue = metadata.note?.trim() ? metadata.note : "None";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-16 lg:px-10">
      <section className="glass-panel rounded-[2rem] p-8 sm:p-10">
        <div className="flex flex-col gap-6 border-b border-[var(--line)] pb-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="eyebrow">Coinbase Business API Demo</p>
            <h1 className="display-font mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              {copy.title}
            </h1>
            <p className="muted-copy mt-5 max-w-2xl text-base leading-8 sm:text-lg">
              {copy.body}
            </p>
          </div>
          <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 px-5 py-4 text-right">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-soft)]">
              Receipt ID
            </p>
            <p className="mt-2 font-mono text-sm text-[var(--foreground)]">
              {maskIdentifier(checkoutId)}
            </p>
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-[1.75rem] border border-[var(--line)] bg-white/82 p-6 shadow-[0_18px_50px_rgba(54,103,255,0.08)] sm:p-7">
            <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-6 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-soft)]">
                  Amount paid
                </p>
                <p className="display-font mt-3 text-4xl font-semibold tracking-[-0.04em]">
                  {amountValue}
                </p>
              </div>
              <span
                className={`inline-flex w-fit rounded-full px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] ${getStatusStyle(displayStatus)}`}
              >
                {displayStatus}
              </span>
            </div>

            <dl className="mt-6">
              <ReceiptRow label="Reference" value={receiptReference} />
              <ReceiptRow label="Checkout ID" mono value={checkoutId} />
              <ReceiptRow
                href={checkoutUrl || undefined}
                label="Payment link URL"
                mono
                value={checkoutUrl || "Not available"}
              />
              <ReceiptRow label="Wallet address" mono value={walletAddress} />
              <ReceiptRow label="Network" value={checkout?.network ?? "Base"} />
              <ReceiptRow
                label="Transaction hash"
                mono
                value={checkout?.transactionHash ?? "Pending"}
              />
              <ReceiptRow
                label="Created"
                value={formatTimestamp(checkout?.createdAt ?? storedReceipt?.createdAt)}
              />
              <ReceiptRow
                label="Last updated"
                value={formatTimestamp(checkout?.updatedAt ?? checkout?.createdAt)}
              />
              <ReceiptRow label="Internal note" value={noteValue} />
            </dl>

            {checkoutError ? (
              <div className="mt-6 rounded-[1.25rem] border border-[#efc8c3] bg-[#fbefed] px-4 py-3 text-sm leading-6 text-[#8f352d]">
                {checkoutError}
              </div>
            ) : null}
          </section>

          <div className="space-y-6">
            <section className="rounded-[1.75rem] border border-[var(--line)] bg-white/78 p-6 sm:p-7">
              <p className="eyebrow">Receipt metadata</p>
              {metadataEntries.length > 0 ? (
                <dl className="mt-5 space-y-4">
                  {metadataEntries.map(([key, value]) => (
                    <div
                      key={key}
                      className="rounded-[1.25rem] border border-[var(--line)] bg-[#f8fbff] px-4 py-3"
                    >
                      <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                        {formatLabel(key)}
                      </dt>
                      <dd className="mt-2 break-words text-sm leading-7 text-[var(--foreground)]">
                        {value || "Not provided"}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="muted-copy mt-5 text-sm leading-7">
                  No metadata was stored with this checkout.
                </p>
              )}
            </section>

            <section className="rounded-[1.75rem] border border-[var(--line)] bg-white/78 p-6 sm:p-7">
              <p className="eyebrow">Actions</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  className="inline-flex items-center rounded-full bg-[var(--accent-strong)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent)] hover:shadow-[0_14px_44px_rgba(54,103,255,0.28)]"
                  href="/"
                >
                  Back to demo
                </Link>
                {checkoutUrl ? (
                  <a
                    className="inline-flex items-center rounded-full border border-[var(--line)] bg-white px-6 py-3 text-sm font-semibold text-[var(--foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent-strong)]"
                    href={checkoutUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open payment link
                  </a>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </section>
    </main>
  );
}
