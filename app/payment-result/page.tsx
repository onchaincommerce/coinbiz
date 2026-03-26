import Link from "next/link";

type PaymentResultPageProps = {
  searchParams: Promise<{
    environment?: string;
    status?: string;
  }>;
};

function getStatusCopy(status?: string) {
  if (status === "success") {
    return {
      body: "Coinbase redirected back after a successful payment. The webhook feed on the home page should reflect the same status.",
      title: "Payment completed",
    };
  }

  if (status === "failed") {
    return {
      body: "Coinbase redirected back after a failed payment. Review the event feed and checkout details to confirm the exact state transition.",
      title: "Payment failed",
    };
  }

  return {
    body: "This route is ready for Coinbase checkout redirects. Return to the demo dashboard to launch another payment or inspect webhook activity.",
    title: "Redirect received",
  };
}

export default async function PaymentResultPage({
  searchParams,
}: PaymentResultPageProps) {
  const { environment, status } = await searchParams;
  const copy = getStatusCopy(status);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col justify-center px-6 py-16 lg:px-10">
      <section className="glass-panel rounded-[2rem] p-8 sm:p-10">
        <p className="eyebrow">Coinbase Redirect</p>
        <h1 className="display-font mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          {copy.title}
        </h1>
        <p className="muted-copy mt-5 max-w-2xl text-base leading-8 sm:text-lg">
          {copy.body}
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3 text-sm text-[var(--ink-soft)]">
          <span className="rounded-full border border-[var(--line)] bg-white/70 px-4 py-2">
            Environment: {environment ?? "not provided"}
          </span>
          <span className="rounded-full border border-[var(--line)] bg-white/70 px-4 py-2">
            Status: {status ?? "unknown"}
          </span>
        </div>
        <div className="mt-10">
          <Link
            className="inline-flex items-center rounded-full bg-[var(--foreground)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)]"
            href="/"
          >
            Back to demo
          </Link>
        </div>
      </section>
    </main>
  );
}
