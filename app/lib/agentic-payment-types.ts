export type AgentCheckoutPaymentStage =
  | "created"
  | "payload_resolved"
  | "signed"
  | "submitted"
  | "completed"
  | "failed";

export interface AgentCheckoutPaymentAttempt {
  amount: string;
  checkoutId: string;
  checkoutUrl: string;
  contractAddress?: string;
  correlationId: string;
  createdAt: string;
  environment: "live";
  errorCode?: string;
  errorMessage?: string;
  id: string;
  lastReconciledAt?: string;
  network: "base";
  payerAddress?: string;
  paymentInfo?: unknown;
  rawCheckoutStatus?: unknown;
  rawHostedPayload?: unknown;
  rawSubmissionResponse?: unknown;
  signatureRef?: string;
  stage: AgentCheckoutPaymentStage;
  submissionEndpoint?: string;
  submissionRequestId?: string;
  token: "USDC";
  tokenCollector?: string;
  txHash?: string;
  updatedAt: string;
  version?: "v1" | "v2";
}

export interface HostedPaymentLinkPayload {
  authorizationExpiry: string;
  contractAddress: string;
  createdAt?: string;
  entity: string;
  failRedirectUrl?: string;
  feeReceiver: string;
  fiat?: {
    amount: string;
    currency: string;
  };
  hostUrl?: string;
  id: string;
  maxAmount: string;
  maxFeeBps: number;
  maxUsage?: number;
  merchant?: {
    name?: string;
  };
  minFeeBps: number;
  networkId: number;
  nonce: `0x${string}`;
  operator: string;
  preApprovalExpiry: string;
  receiver: string;
  refundExpiry: string;
  salt: `0x${string}`;
  status: string;
  successRedirectUrl?: string;
  token: string;
  updatedAt?: string;
  url: string;
  usageCount?: number;
}

export interface SerializableAuthorizationRequest {
  domain: {
    chainId: number;
    name: string;
    verifyingContract: string;
    version: string;
  };
  message: {
    from: string;
    nonce: string;
    to: string;
    validAfter: string;
    validBefore: string;
    value: string;
  };
  primaryType: "ReceiveWithAuthorization";
  types: {
    ReceiveWithAuthorization: Array<{
      name: string;
      type: string;
    }>;
  };
}

export interface HeadlessCheckoutResolution {
  callbackUrl: string;
  hostedPaymentLink: HostedPaymentLinkPayload;
  paymentInfo: SerializableAuthorizationRequest;
  tokenCollector: string;
  version: "v1";
}
