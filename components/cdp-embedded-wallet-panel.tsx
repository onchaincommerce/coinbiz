"use client";

import { Component, type ErrorInfo, useEffect, useMemo, useState } from "react";

import { CDPReactProvider, type Config as CDPReactConfig } from "@coinbase/cdp-react";
import {
  useCreateEvmEoaAccount,
  useCurrentUser,
  useEvmAddress,
  useIsInitialized,
  useIsSignedIn,
  useSignInWithEmail,
  useSignOut,
  useVerifyEmailOTP,
} from "@coinbase/cdp-hooks";

import {
  EMBEDDED_WALLET_STATE_EVENT,
  type EmbeddedWalletSessionState,
} from "@/app/lib/cdp/embedded-wallet-state";

export type EmbeddedWalletPanelConfig = {
  appLogoUrl?: string;
  appName: string;
  projectId: string;
};

type EmbeddedWalletPanelProps = {
  config: EmbeddedWalletPanelConfig;
  variant?: "default" | "compact";
};

type ErrorBoundaryProps = {
  children: React.ReactNode;
  config: EmbeddedWalletPanelConfig;
  variant: "default" | "compact";
};

type ErrorBoundaryState = {
  error: Error | null;
};

function getEmbeddedWalletConfig(
  config: EmbeddedWalletPanelConfig,
): CDPReactConfig {
  return {
    appLogoUrl: config.appLogoUrl,
    appName: config.appName,
    disableAnalytics: true,
    ethereum: {
      createOnLogin: "eoa",
    },
    projectId: config.projectId,
  };
}

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function useOrigin() {
  const [origin] = useState(() =>
    typeof window === "undefined" ? "" : window.location.origin,
  );

  return origin;
}

function EmbeddedWalletErrorCard(props: {
  config: EmbeddedWalletPanelConfig;
  message: string;
  origin: string;
  variant: "default" | "compact";
}) {
  const titleClassName =
    props.variant === "compact"
      ? "display-font mt-3 text-xl font-semibold tracking-[-0.03em] text-[var(--foreground)]"
      : "display-font text-2xl font-semibold tracking-tight text-slate-950";
  const bodyClassName =
    props.variant === "compact"
      ? "text-sm leading-7 text-[var(--ink-soft)]"
      : "max-w-xl text-sm leading-6 text-slate-600";
  const cardClassName =
    props.variant === "compact"
      ? "rounded-[1.25rem] border border-[var(--line)] bg-white/78 px-4 py-4"
      : "rounded-3xl border border-slate-200 bg-white/88 p-5";
  const errorMessageClassName =
    props.variant === "compact"
      ? "rounded-[1.25rem] bg-[#fbefed] px-4 py-3 text-sm text-[#8f352d]"
      : "rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-100";

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="eyebrow">Embedded Wallet</p>
        <h2 className={titleClassName}>CDP wallet unavailable</h2>
        <p className={bodyClassName}>
          The embedded wallet failed to load, but the rest of the demo remains
          active.
        </p>
      </div>

      <div className={errorMessageClassName}>{props.message}</div>

      <div className={cardClassName}>
        <p className="eyebrow">Checks</p>
        <div className="mt-3 space-y-2 text-sm text-[var(--ink-soft)]">
          <p>
            Project ID:
            {" "}
            <span className="font-mono text-[var(--foreground)]">
              {props.config.projectId}
            </span>
          </p>
          <p>
            Origin:
            {" "}
            <span className="font-mono text-[var(--foreground)]">
              {props.origin || "http://localhost:3000"}
            </span>
          </p>
          <p>
            Confirm this exact origin is allowlisted in CDP Portal and then
            refresh the page.
          </p>
        </div>
      </div>
    </div>
  );
}

class EmbeddedWalletErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  override state: ErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      error,
    };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Embedded wallet panel crashed", error, errorInfo);
  }

  override render() {
    if (this.state.error) {
      return (
        <EmbeddedWalletErrorCard
          config={this.props.config}
          message={this.state.error.message || "Unexpected embedded wallet error."}
          origin={typeof window === "undefined" ? "" : window.location.origin}
          variant={this.props.variant}
        />
      );
    }

    return this.props.children;
  }
}

function EmbeddedWalletPanelInner({
  config,
  variant = "default",
}: EmbeddedWalletPanelProps) {
  const { createEvmEoaAccount } = useCreateEvmEoaAccount();
  const { currentUser } = useCurrentUser();
  const { evmAddress } = useEvmAddress();
  const { isInitialized } = useIsInitialized();
  const { isSignedIn } = useIsSignedIn();
  const { signInWithEmail } = useSignInWithEmail();
  const { signOut } = useSignOut();
  const { verifyEmailOTP } = useVerifyEmailOTP();
  const [authError, setAuthError] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [hasProvisionedWallet, setHasProvisionedWallet] = useState(false);
  const [initTimedOut, setInitTimedOut] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [otp, setOtp] = useState("");
  const origin = useOrigin();
  const userEmail = currentUser?.authenticationMethods.email?.email ?? null;
  const titleClassName =
    variant === "compact"
      ? "display-font mt-3 text-xl font-semibold tracking-[-0.03em] text-[var(--foreground)]"
      : "display-font text-2xl font-semibold tracking-tight text-slate-950";
  const bodyClassName =
    variant === "compact"
      ? "text-sm leading-7 text-[var(--ink-soft)]"
      : "max-w-xl text-sm leading-6 text-slate-600";
  const inputClassName =
    variant === "compact"
      ? "w-full rounded-[1.25rem] border border-[var(--line)] bg-white px-4 py-3 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)]"
      : "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100";
  const primaryButtonClassName =
    variant === "compact"
      ? "rounded-full bg-[var(--accent-strong)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent)] hover:shadow-[0_14px_44px_rgba(54,103,255,0.28)] disabled:cursor-not-allowed disabled:opacity-60"
      : "inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60";
  const secondaryButtonClassName =
    variant === "compact"
      ? "rounded-full border border-[var(--line)] px-5 py-3 text-sm font-semibold text-[var(--ink-soft)] transition hover:border-[var(--foreground)] hover:text-[var(--foreground)]"
      : "inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50";
  const cardClassName =
    variant === "compact"
      ? "rounded-[1.25rem] border border-[var(--line)] bg-white/78 px-4 py-4"
      : "rounded-3xl border border-slate-200 bg-white/88 p-5";
  const subtleCardClassName =
    variant === "compact"
      ? "rounded-[1.25rem] border border-[var(--line)] bg-white/78 px-4 py-4 text-sm leading-7 text-[var(--ink-soft)]"
      : "rounded-3xl border border-slate-200 bg-white/80 p-4 text-sm text-slate-600";
  const successBadgeClassName =
    variant === "compact"
      ? "rounded-full bg-[#e8f7f3] px-3 py-1 text-xs font-semibold text-[#1b7f63]"
      : "inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200";
  const successMessageClassName =
    variant === "compact"
      ? "rounded-[1.25rem] bg-[#e8f7f3] px-4 py-3 text-sm text-[#1b7f63]"
      : "rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ring-1 ring-emerald-100";
  const errorMessageClassName =
    variant === "compact"
      ? "rounded-[1.25rem] bg-[#fbefed] px-4 py-3 text-sm text-[#8f352d]"
      : "rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-100";

  useEffect(() => {
    const nextState: EmbeddedWalletSessionState = {
      email: userEmail,
      evmAddress: evmAddress ?? null,
      isInitialized,
      isSignedIn,
      userId: currentUser?.userId ?? null,
    };

    window.__coinbizEmbeddedWalletState = nextState;
    window.dispatchEvent(
      new CustomEvent<EmbeddedWalletSessionState>(EMBEDDED_WALLET_STATE_EVENT, {
        detail: nextState,
      }),
    );
  }, [currentUser?.userId, evmAddress, isInitialized, isSignedIn, userEmail]);

  useEffect(() => {
    if (isInitialized) {
      setInitTimedOut(false);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setInitTimedOut(true);
    }, 12000);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isInitialized]);

  useEffect(() => {
    if (!isInitialized || !isSignedIn || evmAddress || hasProvisionedWallet) {
      return;
    }

    let isActive = true;

    void (async () => {
      try {
        await createEvmEoaAccount();

        if (!isActive) {
          return;
        }

        setHasProvisionedWallet(true);
        setAuthStatus("Embedded wallet ready.");
      } catch (error) {
        if (!isActive) {
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : "Wallet created, but the EVM account is not ready yet.";

        if (/already has an EVM EOA account/i.test(message)) {
          setHasProvisionedWallet(true);
          return;
        }

        setAuthError(message);
      }
    })();

    return () => {
      isActive = false;
    };
  }, [
    createEvmEoaAccount,
    evmAddress,
    hasProvisionedWallet,
    isInitialized,
    isSignedIn,
  ]);

  async function handleEmailSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!email.trim()) {
      setAuthError("Enter an email address to start the embedded wallet flow.");
      return;
    }

    try {
      setIsSubmitting(true);
      setAuthError(null);
      setAuthStatus(null);
      const result = await signInWithEmail({ email: email.trim() });
      setFlowId(result.flowId);
      setOtp("");
      setAuthStatus(`OTP sent to ${email.trim()}.`);
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "Unable to start sign-in.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleOtpSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!flowId || !otp.trim()) {
      setAuthError("Enter the six-digit code from your email.");
      return;
    }

    try {
      setIsSubmitting(true);
      setAuthError(null);
      const result = await verifyEmailOTP({ flowId, otp: otp.trim() });
      setAuthStatus(
        result.message ||
          "Embedded wallet ready."
      );
      setFlowId(null);
      setOtp("");
      setHasProvisionedWallet(Boolean(result.user?.evmAccounts?.length));
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : "Unable to verify the email code.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignOut() {
    try {
      setIsSubmitting(true);
      setAuthError(null);
      await signOut();
      setAuthStatus("Signed out.");
      setFlowId(null);
      setOtp("");
      setHasProvisionedWallet(false);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to sign out.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!isInitialized) {
    if (initTimedOut) {
      if (variant === "compact") {
        return null;
      }

      return (
        <EmbeddedWalletErrorCard
          config={config}
          message="CDP initialization is taking too long. The project allowlist or SDK session bootstrap is still failing."
          origin={origin}
          variant={variant}
        />
      );
    }

    if (variant === "compact") {
      return (
        <div className="space-y-3">
          <div className="h-5 w-28 animate-pulse rounded-full bg-white/60" />
          <div className="h-12 animate-pulse rounded-[1.25rem] bg-white/60" />
        </div>
      );
    }

    return (
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="eyebrow">Embedded Wallet</p>
          <h2 className={titleClassName}>Initializing CDP wallet</h2>
          <p className={bodyClassName}>
            Connecting the embedded wallet SDK for
            {" "}
            <span className="font-mono text-[var(--foreground)]">
              {origin || "http://localhost:3000"}
            </span>
            .
          </p>
        </div>

        <div className="space-y-4">
          <div className="h-4 w-28 animate-pulse rounded-full bg-white/60" />
          <div className="h-16 animate-pulse rounded-3xl bg-white/60" />
          <div className="h-16 animate-pulse rounded-3xl bg-white/60" />
        </div>

        <div className={subtleCardClassName}>
          This should resolve in a few seconds. If it does not, refresh the
          page after confirming
          {" "}
          <span className="font-mono text-[var(--foreground)]">
            {origin || "http://localhost:3000"}
          </span>
          {" "}
          is allowlisted for project
          {" "}
          <span className="font-mono text-[var(--foreground)]">
            {config.projectId}
          </span>
          .
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="eyebrow">Embedded Wallet</p>
        <h2 className={titleClassName}>
          {variant === "compact"
            ? "Sign in to pay"
            : "Email OTP inside your brand shell"}
        </h2>
        {variant === "compact" ? null : (
          <p className={bodyClassName}>
            This pane uses Coinbase Embedded Wallets. No extension, no redirect,
            no hosted checkout handoff.
          </p>
        )}
      </div>

      {!isSignedIn ? (
        <div className="space-y-4">
          {!flowId ? (
            <form className="space-y-3" onSubmit={handleEmailSubmit}>
              <label
                className="block text-sm font-medium text-[var(--foreground)]"
                htmlFor={`wallet-email-${variant}`}
              >
                Email address
              </label>
              <input
                id={`wallet-email-${variant}`}
                autoComplete="email"
                className={inputClassName}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="operator@coinbiz.app"
                type="email"
                value={email}
              />
              <button
                className={cn(
                  primaryButtonClassName,
                  variant === "default" &&
                    "inline-flex min-h-12 items-center justify-center",
                )}
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? "Sending code..." : "Send email code"}
              </button>
            </form>
          ) : (
            <form className="space-y-3" onSubmit={handleOtpSubmit}>
              <label
                className="block text-sm font-medium text-[var(--foreground)]"
                htmlFor={`wallet-otp-${variant}`}
              >
                One-time password
              </label>
              <input
                id={`wallet-otp-${variant}`}
                className={cn(
                  inputClassName,
                  "text-center font-mono text-lg tracking-[0.35em]",
                )}
                inputMode="numeric"
                maxLength={6}
                onChange={(event) =>
                  setOtp(event.target.value.replace(/\D/g, ""))
                }
                placeholder="123456"
                type="text"
                value={otp}
              />
              <div className="flex flex-wrap gap-3">
                <button
                  className={cn(
                    primaryButtonClassName,
                    variant === "default" &&
                      "inline-flex min-h-12 items-center justify-center",
                  )}
                  disabled={isSubmitting || otp.trim().length !== 6}
                  type="submit"
                >
                  {isSubmitting ? "Verifying..." : "Verify code"}
                </button>
                <button
                  className={cn(
                    secondaryButtonClassName,
                    variant === "default" &&
                      "inline-flex min-h-12 items-center justify-center bg-white",
                  )}
                  onClick={() => {
                    setFlowId(null);
                    setOtp("");
                    setAuthError(null);
                    setAuthStatus(null);
                  }}
                  type="button"
                >
                  Change email
                </button>
              </div>
            </form>
          )}

          {variant === "compact" ? null : (
            <div className={subtleCardClassName}>
              The embedded wallet remains user-custodied. Your app gets embedded
              wallet UX, but it does not get the user’s private key.
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {variant === "compact" ? (
            <div className={cardClassName}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="eyebrow">Wallet Ready</p>
                  <p className="mt-3 break-all font-mono text-sm text-[var(--foreground)]">
                    {userEmail ?? "Email verified"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className={secondaryButtonClassName}
                    disabled={isSubmitting}
                    onClick={() => void handleSignOut()}
                    type="button"
                  >
                    {isSubmitting ? "Signing out..." : "Sign out"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div className={cardClassName}>
                  <p className="eyebrow">Wallet Status</p>
                  <p className="mt-3 text-sm text-[var(--ink-soft)]">Email</p>
                  <p className="mt-1 break-all font-mono text-sm text-[var(--foreground)]">
                    {userEmail ?? "Email verified"}
                  </p>
                </div>
                <div className={cardClassName}>
                  <p className="eyebrow">Identity</p>
                  <p className="mt-3 text-sm text-[var(--ink-soft)]">User ID</p>
                  <p className="mt-1 break-all font-mono text-sm text-[var(--foreground)]">
                    {currentUser?.userId ?? "Authenticated"}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <span className={successBadgeClassName}>Signed in without redirect</span>
                <button
                  className={cn(
                    secondaryButtonClassName,
                    "inline-flex min-h-12 items-center justify-center bg-white",
                  )}
                  disabled={isSubmitting}
                  onClick={() => void handleSignOut()}
                  type="button"
                >
                  {isSubmitting ? "Signing out..." : "Sign out"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {authStatus ? <p className={successMessageClassName}>{authStatus}</p> : null}

      {authError ? <p className={errorMessageClassName}>{authError}</p> : null}
    </div>
  );
}

export function EmbeddedWalletPanel({
  config,
  variant = "default",
}: EmbeddedWalletPanelProps) {
  const providerConfig = useMemo(() => getEmbeddedWalletConfig(config), [config]);

  return (
    <EmbeddedWalletErrorBoundary config={config} variant={variant}>
      <CDPReactProvider
        config={providerConfig}
        name={`coinbiz-embedded-wallet-${variant}`}
      >
        <EmbeddedWalletPanelInner config={config} variant={variant} />
      </CDPReactProvider>
    </EmbeddedWalletErrorBoundary>
  );
}
