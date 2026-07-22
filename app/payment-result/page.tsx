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
import { CdsIcon } from "@/components/cds-icon";

type PaymentResultPageProps = {
  searchParams: Promise<{
    environment?: string;
    reference?: string;
    status?: string;
  }>;
};

const statusStyles: Record<string, string> = {
  ACTIVE: "cds-status cds-status-primary",
  COMPLETED: "cds-status cds-status-positive",
  DEACTIVATED: "cds-status cds-status-neutral",
  EXPIRED: "cds-status cds-status-warning",
  FAILED: "cds-status cds-status-negative",
  PROCESSING: "cds-status cds-status-primary",
  SUCCESS: "cds-status cds-status-positive",
};

function isEnvironment(value?: string): value is CheckoutEnvironment {
  return value === "sandbox" || value === "live";
}

function getStatusStyle(status: string) {
  return statusStyles[status] ?? "cds-status cds-status-neutral";
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
            <CdsIcon className="ml-2" name="externalLink" size={12} />
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
    <main className="receipt-page mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-16 lg:px-10">
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
          <div className="receipt-surface rounded-[1.5rem] px-5 py-4 text-right">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-soft)]">
              Receipt ID
            </p>
            <p className="mt-2 font-mono text-sm text-[var(--foreground)]">
              {maskIdentifier(checkoutId)}
            </p>
          </div>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="receipt-surface rounded-[1.75rem] p-6 sm:p-7">
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
                className={getStatusStyle(displayStatus)}
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
              <div className="cds-feedback cds-feedback-negative mt-6">
                {checkoutError}
              </div>
            ) : null}
          </section>

          <div className="space-y-6">
            <section className="receipt-surface rounded-[1.75rem] p-6 sm:p-7">
              <p className="eyebrow">Receipt metadata</p>
              {metadataEntries.length > 0 ? (
                <dl className="mt-5 space-y-4">
                  {metadataEntries.map(([key, value]) => (
                    <div
                      key={key}
                      className="receipt-metadata-row rounded-[1.25rem] px-4 py-3"
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

            <section className="receipt-surface rounded-[1.75rem] p-6 sm:p-7">
              <p className="eyebrow">Actions</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  className="cds-button cds-button-primary"
                  href="/"
                >
                  <CdsIcon name="arrowLeft" size={16} />
                  Back to demo
                </Link>
                {checkoutUrl ? (
                  <a
                    className="cds-button cds-button-secondary"
                    href={checkoutUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open payment link
                    <CdsIcon name="externalLink" size={16} />
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
