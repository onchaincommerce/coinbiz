import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { getAddress } from "viem";
import { parseUnits } from "viem";

import type { AgentCheckoutWalletProvider } from "@/app/lib/agent-checkout-types";

const execFileAsync = promisify(execFile);

export type SendUsdcInput = {
  amountUsdc: string;
  chain: "base";
  checkoutId: string;
  recipientAddress: string;
};

export type SendUsdcResult = {
  payerAddress?: string;
  provider: AgentCheckoutWalletProvider;
  raw: unknown;
  txHash?: string;
};

export interface AgentWalletProvider {
  id: AgentCheckoutWalletProvider;
  sendUsdc(input: SendUsdcInput): Promise<SendUsdcResult>;
}

function readProviderName(): AgentCheckoutWalletProvider {
  const configured = process.env.AGENT_WALLET_PROVIDER?.trim();

  if (configured === "cdp-server-wallet" || configured === "agentic-wallet-cli") {
    return configured;
  }

  if (configured === "mock" && process.env.NODE_ENV !== "production") {
    return configured;
  }

  return process.env.NODE_ENV === "production"
    ? "cdp-server-wallet"
    : "agentic-wallet-cli";
}

function extractFirstString(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;

  for (const key of keys) {
    const entry = record[key];

    if (typeof entry === "string" && entry.trim()) {
      return entry.trim();
    }
  }

  for (const entry of Object.values(record)) {
    if (entry && typeof entry === "object") {
      const nested = extractFirstString(entry, keys);

      if (nested) {
        return nested;
      }
    }
  }

  return undefined;
}

async function loadAgentKitModule() {
  const moduleName = "@coinbase/agentkit";
  const importOptionalDependency = new Function(
    "specifier",
    "return import(specifier)",
  ) as (specifier: string) => Promise<unknown>;

  try {
    return await importOptionalDependency(moduleName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to load ${moduleName}. Install @coinbase/agentkit and configure CDP_WALLET_SECRET for the production agent wallet. ${message}`,
    );
  }
}

class CdpServerWalletProvider implements AgentWalletProvider {
  id = "cdp-server-wallet" as const;

  async sendUsdc(input: SendUsdcInput): Promise<SendUsdcResult> {
    const agentKit = (await loadAgentKitModule()) as {
      CdpV2WalletProvider?: {
        configureWithWallet: (config: Record<string, unknown>) => Promise<{
          getAddress?: () => Promise<string> | string;
          transfer?: (transferInput: Record<string, unknown>) => Promise<unknown>;
        }>;
      };
    };
    const providerFactory = agentKit.CdpV2WalletProvider;

    if (!providerFactory) {
      throw new Error("@coinbase/agentkit did not expose CdpV2WalletProvider.");
    }

    const walletProvider = await providerFactory.configureWithWallet({
      address: process.env.AGENT_WALLET_ADDRESS?.trim() || undefined,
      apiKeyId: process.env.CDP_API_KEY_ID,
      apiKeySecret: process.env.CDP_API_KEY_SECRET,
      idempotencyKey:
        process.env.AGENT_WALLET_IDEMPOTENCY_KEY?.trim() ||
        `coinbiz-agent-${input.checkoutId}`,
      networkId: "base",
      walletSecret: process.env.CDP_WALLET_SECRET,
    });

    if (!walletProvider.transfer) {
      throw new Error("Configured CDP wallet provider does not support transfers.");
    }

    const raw = await walletProvider.transfer({
      amount: parseUnits(input.amountUsdc, 6),
      network: "base",
      to: getAddress(input.recipientAddress),
      token: "usdc",
    });
    const payerAddress =
      typeof walletProvider.getAddress === "function"
        ? await walletProvider.getAddress()
        : process.env.AGENT_WALLET_ADDRESS?.trim();

    return {
      payerAddress,
      provider: this.id,
      raw,
      txHash: extractFirstString(raw, [
        "transactionHash",
        "txHash",
        "hash",
        "transaction_hash",
      ]),
    };
  }
}

class AgenticWalletCliProvider implements AgentWalletProvider {
  id = "agentic-wallet-cli" as const;

  async sendUsdc(input: SendUsdcInput): Promise<SendUsdcResult> {
    const { stdout, stderr } = await execFileAsync(
      "npx",
      [
        "awal@latest",
        "send",
        input.amountUsdc,
        getAddress(input.recipientAddress),
        "--chain",
        input.chain,
        "--json",
      ],
      {
        maxBuffer: 1024 * 1024,
        timeout: 120_000,
      },
    );
    const trimmedStdout = stdout.trim();
    let raw: unknown = trimmedStdout;

    if (trimmedStdout) {
      try {
        raw = JSON.parse(trimmedStdout) as unknown;
      } catch {
        raw = {
          stderr: stderr.trim(),
          stdout: trimmedStdout,
        };
      }
    }

    return {
      payerAddress: extractFirstString(raw, ["from", "sender", "payer", "address"]),
      provider: this.id,
      raw,
      txHash: extractFirstString(raw, [
        "transactionHash",
        "txHash",
        "hash",
        "signature",
      ]),
    };
  }
}

class MockAgentWalletProvider implements AgentWalletProvider {
  id = "mock" as const;

  async sendUsdc(input: SendUsdcInput): Promise<SendUsdcResult> {
    return {
      payerAddress: "0x0000000000000000000000000000000000000001",
      provider: this.id,
      raw: {
        checkoutId: input.checkoutId,
        mode: "mock",
      },
      txHash: `0x${"a".repeat(64)}`,
    };
  }
}

export function getAgentWalletProvider() {
  const providerName = readProviderName();

  switch (providerName) {
    case "agentic-wallet-cli":
      return new AgenticWalletCliProvider();
    case "mock":
      return new MockAgentWalletProvider();
    default:
      return new CdpServerWalletProvider();
  }
}
