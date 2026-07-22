import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;

  return NextResponse.json({
    components: {
      schemas: {
        PayRequest: {
          additionalProperties: false,
          properties: {
            checkoutId: {
              description: "Coinbiz agent-checkout UUID. Use this when already known.",
              type: "string",
            },
            url: {
              description: "URL that may resolve to a Coinbiz agent-checkout link.",
              type: "string",
            },
          },
          type: "object",
        },
        UrlRequest: {
          additionalProperties: false,
          properties: {
            url: {
              description: "HTTP or HTTPS purchase URL to inspect.",
              type: "string",
            },
            userIntent: {
              description: "Optional short description of what the user wants to buy.",
              type: "string",
            },
          },
          required: ["url"],
          type: "object",
        },
      },
      securitySchemes: {
        AgentCommerceApiKey: {
          description: "Use Authorization: Bearer <AGENT_COMMERCE_API_KEY>.",
          in: "header",
          name: "Authorization",
          type: "apiKey",
        },
      },
    },
    info: {
      description:
        "Crawl purchase links and pay only signed Coinbiz agent-checkout requests. This API does not use x402 and does not pay arbitrary store checkouts.",
      title: "Coinbiz Agent Commerce",
      version: "0.1.0",
    },
    openapi: "3.1.0",
    paths: {
      "/api/agent-commerce/crawl": {
        post: {
          description:
            "Fetches a purchase URL, extracts product metadata, and detects signed Coinbiz agent-checkout links.",
          operationId: "crawlPurchaseUrl",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/UrlRequest",
                },
              },
            },
            required: true,
          },
          responses: {
            "200": {
              description: "Crawled purchase page metadata and checkout detection.",
            },
          },
          security: [
            {
              AgentCommerceApiKey: [],
            },
          ],
          summary: "Crawl purchase URL",
          "x-openai-isConsequential": false,
        },
      },
      "/api/agent-commerce/pay": {
        post: {
          description:
            "Pays a signed Coinbiz agent-checkout request after wallet policy checks. Does not pay arbitrary stores.",
          operationId: "payCoinbizAgentCheckout",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/PayRequest",
                },
              },
            },
            required: true,
          },
          responses: {
            "200": {
              description: "Payment submitted or completed.",
            },
            "409": {
              description: "Payment rejected by policy, already submitted, or unsupported.",
            },
          },
          security: [
            {
              AgentCommerceApiKey: [],
            },
          ],
          summary: "Pay Coinbiz checkout",
          "x-openai-isConsequential": true,
        },
      },
      "/api/agent-commerce/plan": {
        post: {
          description:
            "Builds a purchase plan from a URL and returns whether the agent wallet can pay it.",
          operationId: "planPurchaseFromUrl",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/UrlRequest",
                },
              },
            },
            required: true,
          },
          responses: {
            "200": {
              description: "Purchase plan with payable status and policy reason.",
            },
          },
          security: [
            {
              AgentCommerceApiKey: [],
            },
          ],
          summary: "Plan purchase from URL",
          "x-openai-isConsequential": false,
        },
      },
    },
    servers: [
      {
        url: origin,
      },
    ],
  });
}
