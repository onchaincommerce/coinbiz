import type { AgentCheckoutPublicView } from "@/app/lib/agent-checkout-types";
import {
  AGENT_CHECKOUT_CHAIN,
  AGENT_CHECKOUT_TOKEN,
  getAgentCheckoutMaxUsdc,
  toAgentCheckoutPublicView,
} from "@/app/lib/agent-checkout-policy";
import {
  extractAgentCheckoutIdFromText,
  inspectAgentCheckout,
  payAgentCheckout,
} from "@/app/lib/agent-checkouts";

type JsonRecord = Record<string, unknown>;

export type AgentCommerceCrawl = {
  agentCheckoutId?: string;
  agentCheckoutUrl?: string;
  contentType?: string;
  currency?: string;
  description?: string;
  fetchError?: string;
  finalUrl: string;
  image?: string;
  inputUrl: string;
  payable: boolean;
  price?: string;
  productName?: string;
  status: number;
  title?: string;
  unsupportedReason?: string;
};

export type AgentCommercePlan = {
  checkout?: AgentCheckoutPublicView;
  crawl: AgentCommerceCrawl;
  maxAutonomousUsdc: string;
  nextAction: "pay_coinbiz_checkout" | "unsupported_external_checkout";
  payable: boolean;
  reason: string;
  requiredRail: "coinbiz_agent_checkout";
};

const MAX_CRAWL_TEXT_LENGTH = 1_000_000;
const CRAWL_TIMEOUT_MS = 10_000;
const UUID_SOURCE =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function decodeHtmlEntities(value: string) {
  return value.replace(
    /&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi,
    (match, entity: string) => {
      const lower = entity.toLowerCase();

      if (lower === "amp") return "&";
      if (lower === "lt") return "<";
      if (lower === "gt") return ">";
      if (lower === "quot") return '"';
      if (lower === "apos") return "'";
      if (lower === "nbsp") return " ";

      if (lower.startsWith("#x")) {
        const codePoint = Number.parseInt(lower.slice(2), 16);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      }

      if (lower.startsWith("#")) {
        const codePoint = Number.parseInt(lower.slice(1), 10);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
      }

      return match;
    },
  );
}

function cleanText(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const cleaned = decodeHtmlEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || undefined;
}

function getAttribute(tag: string, name: string) {
  const match = tag.match(
    new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"),
  );

  return cleanText(match?.[1] ?? match?.[2] ?? match?.[3]);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMetaContent(html: string, names: string[]) {
  for (const name of names) {
    const escapedName = escapeRegex(name);
    const tagMatch = html.match(
      new RegExp(
        `<meta\\b(?=[^>]*(?:name|property)\\s*=\\s*["']${escapedName}["'])[^>]*>`,
        "i",
      ),
    );
    const content = tagMatch ? getAttribute(tagMatch[0], "content") : undefined;

    if (content) {
      return content;
    }
  }

  return undefined;
}

function findTitle(html: string) {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return cleanText(titleMatch?.[1]);
}

function resolveMaybeUrl(value: string | undefined, baseUrl: string) {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function normalizeJsonLdType(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(normalizeJsonLdType);
  }

  if (typeof value === "string") {
    return [value.toLowerCase()];
  }

  return [];
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return asString(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = firstString(item);

      if (candidate) {
        return candidate;
      }
    }
  }

  if (isRecord(value)) {
    return firstString(value.url) ?? firstString(value.contentUrl);
  }

  return undefined;
}

function firstOffer(value: unknown): JsonRecord | undefined {
  if (isRecord(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.find(isRecord);
  }

  return undefined;
}

function collectJsonLdCommerce(
  value: unknown,
  results: Partial<AgentCommerceCrawl>[],
) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectJsonLdCommerce(item, results);
    }

    return;
  }

  if (!isRecord(value)) {
    return;
  }

  const types = normalizeJsonLdType(value["@type"]);
  const isProduct = types.includes("product");
  const isOffer = types.includes("offer");

  if (isProduct || isOffer) {
    const offer = isProduct ? firstOffer(value.offers) : value;

    results.push({
      currency: asString(offer?.priceCurrency) ?? asString(value.priceCurrency),
      description: asString(value.description),
      image: firstString(value.image),
      price:
        asString(offer?.price) ??
        asString(offer?.lowPrice) ??
        asString(value.price),
      productName: asString(value.name),
    });
  }

  for (const nested of Object.values(value)) {
    collectJsonLdCommerce(nested, results);
  }
}

function extractJsonLdCommerce(html: string) {
  const results: Partial<AgentCommerceCrawl>[] = [];
  const scriptPattern =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match = scriptPattern.exec(html);

  while (match) {
    try {
      collectJsonLdCommerce(JSON.parse(decodeHtmlEntities(match[1])), results);
    } catch {
      // Some sites ship invalid JSON-LD; the crawler can still use meta tags.
    }

    match = scriptPattern.exec(html);
  }

  return results.find((result) => result.productName || result.price) ?? {};
}

function findAgentCheckoutUrl(html: string, baseUrl: string, originalUrl: string) {
  const directId = extractAgentCheckoutIdFromText(originalUrl);

  if (directId) {
    return {
      id: directId,
      url: originalUrl,
    };
  }

  const attributeMatch = html.match(
    new RegExp(
      `(?:href|src|content|data-href)\\s*=\\s*["']([^"']*\\/agent-checkout\\/${UUID_SOURCE}[^"']*)["']`,
      "i",
    ),
  );
  const rawMatch = html.match(
    new RegExp(
      `https?:\\/\\/[^\\s"'<>)]*\\/agent-checkout\\/${UUID_SOURCE}[^\\s"'<>)]*`,
      "i",
    ),
  );
  const candidate = attributeMatch?.[1] ?? rawMatch?.[0];
  const resolvedUrl = resolveMaybeUrl(candidate, baseUrl);
  const id = resolvedUrl ? extractAgentCheckoutIdFromText(resolvedUrl) : null;

  if (resolvedUrl && id) {
    return {
      id,
      url: resolvedUrl,
    };
  }

  return null;
}

function parseUrlOrThrow(value: string) {
  const url = new URL(value);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https purchase links are supported.");
  }

  return url;
}

function isPrivateHost(url: URL) {
  const hostname = url.hostname.toLowerCase();

  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname.startsWith("127.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

function assertCrawlTargetAllowed(url: URL) {
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  if (isPrivateHost(url)) {
    throw new Error("Private network purchase links are not allowed.");
  }
}

function getUnsupportedReason(crawl: Pick<AgentCommerceCrawl, "title" | "productName">) {
  const item = crawl.productName ?? crawl.title ?? "this page";

  return `I can inspect ${item}, but I cannot complete checkout unless the page exposes a signed Coinbiz agent-checkout request.`;
}

export async function crawlPurchaseUrl(rawUrl: string): Promise<AgentCommerceCrawl> {
  const url = parseUrlOrThrow(rawUrl);
  assertCrawlTargetAllowed(url);

  const directCheckoutId = extractAgentCheckoutIdFromText(url.toString());
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CRAWL_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        accept: "text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5",
        "user-agent": "CoinbizAgentCommerce/0.1",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") ?? undefined;
    const finalUrl = response.url || url.toString();
    const html = (await response.text()).slice(0, MAX_CRAWL_TEXT_LENGTH);
    const jsonLd = extractJsonLdCommerce(html);
    const checkoutLink = findAgentCheckoutUrl(html, finalUrl, url.toString());
    const agentCheckoutId = checkoutLink?.id ?? directCheckoutId ?? undefined;
    const agentCheckoutUrl =
      checkoutLink?.url ?? (directCheckoutId ? url.toString() : undefined);
    const title =
      jsonLd.productName ??
      findMetaContent(html, ["og:title", "twitter:title"]) ??
      findTitle(html);
    const description =
      jsonLd.description ??
      findMetaContent(html, ["description", "og:description", "twitter:description"]);
    const image = resolveMaybeUrl(
      jsonLd.image ??
        findMetaContent(html, ["og:image", "twitter:image", "image"]),
      finalUrl,
    );
    const price =
      jsonLd.price ??
      findMetaContent(html, [
        "product:price:amount",
        "og:price:amount",
        "twitter:data1",
      ]);
    const currency =
      jsonLd.currency ??
      findMetaContent(html, [
        "product:price:currency",
        "og:price:currency",
        "twitter:label1",
      ]);
    const crawl = {
      agentCheckoutId,
      agentCheckoutUrl,
      contentType,
      currency,
      description,
      finalUrl,
      image,
      inputUrl: url.toString(),
      payable: Boolean(agentCheckoutId),
      price,
      productName: jsonLd.productName,
      status: response.status,
      title,
    } satisfies AgentCommerceCrawl;

    return {
      ...crawl,
      unsupportedReason: crawl.payable ? undefined : getUnsupportedReason(crawl),
    };
  } catch (error) {
    if (directCheckoutId) {
      return {
        agentCheckoutId: directCheckoutId,
        agentCheckoutUrl: url.toString(),
        fetchError:
          error instanceof Error ? error.message : "Unable to fetch checkout page.",
        finalUrl: url.toString(),
        inputUrl: url.toString(),
        payable: true,
        status: 0,
      };
    }

    throw new Error(
      error instanceof Error
        ? `Unable to crawl purchase link: ${error.message}`
        : "Unable to crawl purchase link.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function planExternalPurchase(input: {
  url: string;
  userIntent?: string;
}): Promise<AgentCommercePlan> {
  const crawl = await crawlPurchaseUrl(input.url);

  if (!crawl.agentCheckoutId) {
    return {
      crawl,
      maxAutonomousUsdc: getAgentCheckoutMaxUsdc(),
      nextAction: "unsupported_external_checkout",
      payable: false,
      reason:
        crawl.unsupportedReason ??
        "This link did not resolve to a signed Coinbiz agent-checkout request.",
      requiredRail: "coinbiz_agent_checkout",
    };
  }

  const checkout = await inspectAgentCheckout(crawl.agentCheckoutId);

  return {
    checkout,
    crawl,
    maxAutonomousUsdc: getAgentCheckoutMaxUsdc(),
    nextAction: "pay_coinbiz_checkout",
    payable: true,
    reason: `This link resolves to checkout ${checkout.id}: ${checkout.amountUsdc} ${AGENT_CHECKOUT_TOKEN} on ${AGENT_CHECKOUT_CHAIN}.`,
    requiredRail: "coinbiz_agent_checkout",
  };
}

export async function payExternalPurchase(input: {
  checkoutId?: string;
  url?: string;
}) {
  const checkoutId =
    input.checkoutId?.trim() ||
    (input.url
      ? (await planExternalPurchase({ url: input.url })).checkout?.id
      : undefined);

  if (!checkoutId) {
    throw new Error(
      "This link is not payable. The agent can only pay signed Coinbiz agent-checkout requests.",
    );
  }

  return toAgentCheckoutPublicView(await payAgentCheckout(checkoutId));
}
