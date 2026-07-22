const DEMO_PAYMENT_SIGNATURE = "coinbiz-demo-signature";
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DEMO_RECEIVER = "0x1111111111111111111111111111111111111111";

type WorkloadId = "inference" | "gpu";

const workloads = {
  inference: {
    amount: "2500",
    description: "One Llama 3.3 70B inference completion",
  },
  gpu: {
    amount: "25000",
    description: "One NVIDIA H100 SXM 60-second compute lease",
  },
} satisfies Record<WorkloadId, { amount: string; description: string }>;

function encodeHeader(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}

function isWorkloadId(value: unknown): value is WorkloadId {
  return value === "inference" || value === "gpu";
}

export async function POST(request: Request) {
  let requestBody: { workload?: unknown };

  try {
    requestBody = (await request.json()) as { workload?: unknown };
  } catch {
    return Response.json({ error: "A JSON workload is required." }, { status: 400 });
  }

  if (!isWorkloadId(requestBody.workload)) {
    return Response.json(
      { error: "Workload must be either inference or gpu." },
      { status: 400 },
    );
  }

  const workloadId = requestBody.workload;
  const workload = workloads[workloadId];
  const paymentSignature = request.headers.get("payment-signature");

  if (paymentSignature !== DEMO_PAYMENT_SIGNATURE) {
    const paymentRequired = {
      accepts: [
        {
          amount: workload.amount,
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
        description: workload.description,
        mimeType: "application/json",
        url: "/api/x402/compute",
      },
      x402Version: 2,
    };

    return Response.json(
      {
        error: "Payment Required",
        simulation: true,
        workload: workloadId,
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
    amount: workload.amount,
    network: "eip155:84532",
    payer: "0x2222222222222222222222222222222222222222",
    simulation: true,
    success: true,
    transaction: "0xcoinbiz-demo-compute-settlement",
  };
  const responseBody =
    workloadId === "inference"
      ? {
          result: {
            inputTokens: 31,
            latencyMs: 842,
            model: "Llama 3.3 70B",
            output:
              "H100 spot demand remains strongest for short inference bursts, where usage-based access converts idle capacity into immediately available compute.",
            outputTokens: 24,
          },
          simulation: true,
          workload: workloadId,
        }
      : {
          result: {
            accelerator: "NVIDIA H100 SXM",
            durationSeconds: 60,
            leaseId: "gpu_sim_h100_01",
            region: "us-east",
            status: "ready" as const,
          },
          simulation: true,
          workload: workloadId,
        };

  return Response.json(responseBody, {
    headers: {
      "Cache-Control": "no-store",
      "PAYMENT-RESPONSE": encodeHeader(paymentResponse),
    },
  });
}
