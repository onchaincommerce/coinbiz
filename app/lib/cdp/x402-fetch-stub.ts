type WrappedFetch = typeof fetch;

export function wrapFetchWithPayment(): WrappedFetch {
  return (async () => {
    throw new Error(
      "x402 is not enabled in this app. Install the real x402-fetch package before using fetchWithPayment.",
    );
  }) as WrappedFetch;
}
