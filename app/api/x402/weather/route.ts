const DEMO_PAYMENT_SIGNATURE = "coinbiz-demo-signature";
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DEMO_RECEIVER = "0x1111111111111111111111111111111111111111";

function encodeHeader(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}

export async function GET(request: Request) {
  const paymentSignature = request.headers.get("payment-signature");

  if (paymentSignature !== DEMO_PAYMENT_SIGNATURE) {
    const paymentRequired = {
      accepts: [
        {
          amount: "1000",
          asset: BASE_SEPOLIA_USDC,
          extra: {
            name: "USDC",
            version: "2",
          },
          maxTimeoutSeconds: 60,
          network: "eip155:84532",
          payTo: DEMO_RECEIVER,
          scheme: "exact",
        },
      ],
      resource: {
        description: "CoinBiz premium market signal",
        mimeType: "application/json",
        url: "/api/x402/weather",
      },
      x402Version: 2,
    };

    return Response.json(
      {
        error: "Payment Required",
        simulation: true,
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "PAYMENT-REQUIRED": encodeHeader(paymentRequired),
        },
        status: 402,
      },
    );
  }

  const paymentResponse = {
    network: "eip155:84532",
    payer: "0x2222222222222222222222222222222222222222",
    simulation: true,
    success: true,
    transaction: "0xcoinbiz-demo-settlement",
  };

  return Response.json(
    {
      report: {
        confidence: 0.94,
        market: "USDC / USD",
        signal: "stable",
      },
      simulation: true,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "PAYMENT-RESPONSE": encodeHeader(paymentResponse),
      },
    },
  );
}
