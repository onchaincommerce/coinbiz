export class AgentCommerceAuthError extends Error {
  status = 401;
}

export class AgentCommerceConfigError extends Error {
  status = 500;
}

function getBearerToken(value: string | null) {
  if (!value) {
    return "";
  }

  return value.replace(/^Bearer\s+/i, "").trim();
}

export function requireAgentCommerceAuth(request: Request) {
  const configuredKey = process.env.AGENT_COMMERCE_API_KEY?.trim();

  if (!configuredKey) {
    if (process.env.NODE_ENV === "production") {
      throw new AgentCommerceConfigError(
        "AGENT_COMMERCE_API_KEY is required before exposing agent commerce endpoints in production.",
      );
    }

    return;
  }

  const bearerToken = getBearerToken(request.headers.get("authorization"));
  const directKey = request.headers.get("x-coinbiz-agent-key")?.trim() ?? "";

  if (bearerToken !== configuredKey && directKey !== configuredKey) {
    throw new AgentCommerceAuthError("Unauthorized agent commerce request.");
  }
}

export function getAgentCommerceErrorStatus(error: unknown, fallback = 500) {
  if (
    error instanceof AgentCommerceAuthError ||
    error instanceof AgentCommerceConfigError
  ) {
    return error.status;
  }

  return fallback;
}
