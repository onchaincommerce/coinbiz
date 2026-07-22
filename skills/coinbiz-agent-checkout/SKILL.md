---
name: coinbiz-agent-checkout
description: Use when working on Coinbiz agent-checkout payments, external agent purchase links, inspecting or paying Coinbiz /agent-checkout links, or integrating Coinbase Agentic Wallet CLI without x402.
---

# Coinbiz Agent Checkout

Use this skill only for Coinbiz-owned agent checkout links. Do not use x402, x402-fetch, Coinbase hosted checkout typed-data callbacks, or arbitrary store checkout pages for this flow.

## Payment Boundary

- The only payable link format is `/agent-checkout/{uuid}` for this app.
- The only autonomous payment asset is USDC on Base.
- The default autonomous cap is `AGENT_CHECKOUT_MAX_USDC=0.01`.
- Before paying, inspect the request and verify amount, recipient, token, chain, expiry, status, and signature.
- Reject arbitrary ecommerce links unless they first resolve to a signed Coinbiz agent checkout.
- External agents may crawl arbitrary links for product metadata, but spending is still blocked unless the crawl finds a signed Coinbiz checkout.
- Production deployments must protect `/api/agent-commerce/*` POST routes with `AGENT_COMMERCE_API_KEY`.

## Local Commands

Inspect a checkout:

```bash
curl -sS http://127.0.0.1:3000/api/coinbase/agent-checkouts/{id}
```

Pay a checkout through the configured app wallet provider:

```bash
curl -sS -X POST http://127.0.0.1:3000/api/coinbase/agent-checkouts/{id}/pay
```

Sync the receipt:

```bash
curl -sS -X POST http://127.0.0.1:3000/api/coinbase/agent-checkouts/{id}/sync
```

Plan an external purchase link for a ChatGPT Action or another agent:

```bash
curl -sS -X POST http://127.0.0.1:3000/api/agent-commerce/plan \
  -H 'content-type: application/json' \
  --data '{"url":"http://127.0.0.1:3000/agent-checkout/{id}"}'
```

Pay a supported external purchase link:

```bash
curl -sS -X POST http://127.0.0.1:3000/api/agent-commerce/pay \
  -H 'content-type: application/json' \
  --data '{"url":"http://127.0.0.1:3000/agent-checkout/{id}"}'
```

Expose the OpenAPI schema for a Custom GPT Action:

```bash
curl -sS http://127.0.0.1:3000/api/agent-commerce/openapi
```

For local Agentic Wallet CLI experiments, set `AGENT_WALLET_PROVIDER=agentic-wallet-cli`. The app will call:

```bash
npx awal@latest send <amount> <recipient> --chain base --json
```

## Workflow

1. Confirm the app is running and the pasted link is a Coinbiz agent checkout, or crawl/plan the external URL through `/api/agent-commerce/plan`.
2. Inspect the checkout through the API.
3. Do not pay if the request is expired, already paid/submitted, over cap, not Base USDC, or signature validation fails.
4. Pay only through the app endpoint so policy and replay checks stay centralized.
5. Sync until the status is `paid`, `expired`, or `amount_mismatch`.
