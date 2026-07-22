import { notFound } from "next/navigation";

import { inspectAgentCheckout } from "@/app/lib/agent-checkouts";

function formatStatusLabel(status: string) {
  return status
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="grid gap-1 border-b border-[var(--line)] py-3 last:border-b-0 sm:grid-cols-[140px_1fr] sm:gap-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--ink-soft)]">
        {label}
      </p>
      <p className="break-all text-sm text-[var(--foreground)]">{value}</p>
    </div>
  );
}

export default async function AgentCheckoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const checkout = await inspectAgentCheckout(id).catch(() => null);

  if (!checkout) {
    notFound();
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-10 lg:px-8">
      <section className="rounded-[2rem] border border-[var(--line)] bg-white/86 p-6 shadow-[0_18px_50px_rgba(54,103,255,0.12)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Agent Checkout</p>
            <h1 className="display-font mt-3 text-4xl font-semibold tracking-[-0.05em] text-[var(--foreground)]">
              {checkout.amountUsdc} {checkout.token}
            </h1>
          </div>
          <span className="rounded-full border border-[var(--line)] bg-[#f7f9ff] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--ink-soft)]">
            {formatStatusLabel(checkout.status)}
          </span>
        </div>

        <div className="mt-6 divide-y divide-[var(--line)] rounded-[1.5rem] border border-[var(--line)] bg-[#f7f9ff] px-4 py-2">
          <DetailRow label="Checkout ID" value={checkout.id} />
          <DetailRow label="Reference" value={checkout.reference} />
          <DetailRow label="Recipient" value={checkout.recipientAddress} />
          <DetailRow label="Network" value="Base" />
          <DetailRow label="Token" value={checkout.token} />
          <DetailRow label="Expires" value={formatTimestamp(checkout.expiresAt)} />
          <DetailRow label="Signature" value={checkout.paymentRequestSignature} />
          <DetailRow
            label="Transaction"
            value={checkout.txHash ?? "Pending"}
          />
        </div>
      </section>
    </main>
  );
}
