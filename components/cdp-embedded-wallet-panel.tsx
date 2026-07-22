"use client";

import Image from "next/image";
import { Component, type ErrorInfo, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";

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
import { CdsIcon } from "@/components/cds-icon";

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
      ? "cds-elevation-card rounded-[1.25rem] px-4 py-4"
      : "rounded-3xl border border-slate-200 bg-white/88 p-5";
  const errorMessageClassName =
    props.variant === "compact"
      ? "cds-feedback cds-feedback-negative"
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
  const [addressCopied, setAddressCopied] = useState(false);
  const [email, setEmail] = useState("");
  const [flowId, setFlowId] = useState<string | null>(null);
  const [hasProvisionedWallet, setHasProvisionedWallet] = useState(false);
  const [initTimedOut, setInitTimedOut] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [otp, setOtp] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [showTopUp, setShowTopUp] = useState(false);
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
      ? "cds-control w-full"
      : "w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100";
  const primaryButtonClassName =
    variant === "compact"
      ? "cds-button cds-button-primary"
      : "inline-flex min-h-12 items-center justify-center rounded-full bg-slate-950 px-5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60";
  const secondaryButtonClassName =
    variant === "compact"
      ? "cds-button cds-button-secondary"
      : "inline-flex min-h-12 items-center justify-center rounded-full border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50";
  const cardClassName =
    variant === "compact"
      ? "cds-elevation-card rounded-[1.25rem] px-4 py-4"
      : "rounded-3xl border border-slate-200 bg-white/88 p-5";
  const subtleCardClassName =
    variant === "compact"
      ? "cds-elevation-card rounded-[1.25rem] px-4 py-4 text-sm leading-7 text-[var(--ink-soft)]"
      : "rounded-3xl border border-slate-200 bg-white/80 p-4 text-sm text-slate-600";
  const successBadgeClassName =
    variant === "compact"
      ? "cds-status cds-status-positive"
      : "inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200";
  const successMessageClassName =
    variant === "compact"
      ? "cds-feedback cds-feedback-positive"
      : "rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700 ring-1 ring-emerald-100";
  const errorMessageClassName =
    variant === "compact"
      ? "cds-feedback cds-feedback-negative"
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
      setAddressCopied(false);
      setQrDataUrl(null);
      setShowTopUp(false);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Unable to sign out.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopyAddress() {
    if (!evmAddress) {
      return;
    }

    try {
      await navigator.clipboard.writeText(evmAddress);
      setAddressCopied(true);
      window.setTimeout(() => setAddressCopied(false), 1800);
    } catch {
      setAuthError("Unable to copy the wallet address. Select it manually instead.");
    }
  }

  async function handleToggleTopUp() {
    if (!evmAddress) {
      return;
    }

    if (showTopUp) {
      setShowTopUp(false);
      return;
    }

    try {
      setAuthError(null);
      if (!qrDataUrl) {
        setQrDataUrl(
          await QRCode.toDataURL(evmAddress, {
            errorCorrectionLevel: "M",
            margin: 1,
            width: 384,
          }),
        );
      }
      setShowTopUp(true);
    } catch {
      setAuthError("Unable to generate the wallet QR code.");
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
        <div className="embedded-wallet-heading" aria-busy="true">
          <span className="wallet-status-orb" aria-hidden="true" />
          <div>
            <strong>Connecting wallet</strong>
            <small>Starting a secure session…</small>
          </div>
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

  if (variant === "compact") {
    return (
      <div className="embedded-wallet-compact">
        {!isSignedIn ? (
          <>
            <div className="embedded-wallet-heading">
              <span className="wallet-status-orb" aria-hidden="true" />
              <div>
                <strong>Embedded wallet</strong>
                <small>Email-secured · No extension</small>
              </div>
            </div>

            {!flowId ? (
              <form className="wallet-inline-form" onSubmit={handleEmailSubmit}>
                <label className="sr-only" htmlFor="wallet-email-compact">
                  Email address
                </label>
                <input
                  id="wallet-email-compact"
                  autoComplete="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  type="email"
                  value={email}
                />
                <button disabled={isSubmitting} type="submit">
                  {isSubmitting ? "Sending…" : "Continue"}
                </button>
              </form>
            ) : (
              <form className="wallet-inline-form" onSubmit={handleOtpSubmit}>
                <label className="sr-only" htmlFor="wallet-otp-compact">
                  One-time password
                </label>
                <input
                  id="wallet-otp-compact"
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
                  placeholder="6-digit code"
                  type="text"
                  value={otp}
                />
                <button
                  disabled={isSubmitting || otp.trim().length !== 6}
                  type="submit"
                >
                  {isSubmitting ? "Verifying…" : "Verify"}
                </button>
                <button
                  className="wallet-text-action"
                  onClick={() => {
                    setFlowId(null);
                    setOtp("");
                    setAuthError(null);
                    setAuthStatus(null);
                  }}
                  type="button"
                >
                  Back
                </button>
              </form>
            )}
          </>
        ) : (
          <>
            <div className="wallet-ready-line">
              <span className="wallet-status-orb is-ready" aria-hidden="true" />
              <div>
                <strong>{userEmail ?? "Wallet ready"}</strong>
                <small>
                  {evmAddress
                    ? `${evmAddress.slice(0, 8)}…${evmAddress.slice(-6)}`
                    : "Preparing Base address"}
                </small>
              </div>
              <div className="wallet-ready-actions">
                <button
                  className="wallet-utility-action"
                  disabled={!evmAddress}
                  onClick={() => void handleCopyAddress()}
                  type="button"
                >
                  <CdsIcon name="copy" size={12} />
                  {addressCopied ? "Copied" : "Copy"}
                </button>
                <button
                  aria-expanded={showTopUp}
                  className="wallet-utility-action"
                  disabled={!evmAddress}
                  onClick={() => void handleToggleTopUp()}
                  type="button"
                >
                  <CdsIcon name="qrCode" size={12} />
                  {showTopUp ? "Close QR" : "Top up"}
                </button>
                <button
                  className="wallet-text-action"
                  disabled={isSubmitting}
                  onClick={() => void handleSignOut()}
                  type="button"
                >
                  {isSubmitting ? "Signing out…" : "Sign out"}
                </button>
              </div>
            </div>

            {showTopUp && evmAddress && qrDataUrl ? (
              <div className="wallet-topup-panel">
                <Image
                  alt="QR code for the embedded Base wallet address"
                  height={176}
                  src={qrDataUrl}
                  unoptimized
                  width={176}
                />
                <div>
                  <span>Fund from your phone</span>
                  <strong>Send USDC or ETH on Base</strong>
                  <code>{evmAddress}</code>
                  <button onClick={() => void handleCopyAddress()} type="button">
                    <CdsIcon name="copy" size={12} />
                    {addressCopied ? "Address copied" : "Copy full address"}
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}

        {authStatus ? <p className="wallet-message is-success">{authStatus}</p> : null}
        {authError ? <p className="wallet-message is-error">{authError}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="eyebrow">Embedded Wallet</p>
        <h2 className={titleClassName}>Email OTP inside your brand shell</h2>
        <p className={bodyClassName}>
          This pane uses Coinbase Embedded Wallets. No extension, no redirect,
          no hosted checkout handoff.
        </p>
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

          <div className={subtleCardClassName}>
            The embedded wallet remains user-custodied. Your app gets embedded
            wallet UX, but it does not get the user’s private key.
          </div>
        </div>
      ) : (
        <div className="space-y-4">
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
