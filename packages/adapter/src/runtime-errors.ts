export type RuntimeAdapterErrorCode =
  | "openclaw_gateway_not_configured"
  | "openclaw_gateway_unreachable"
  | "openclaw_gateway_not_connected"
  | "openclaw_gateway_request_failed";

export class RuntimeAdapterError extends Error {
  constructor(
    readonly code: RuntimeAdapterErrorCode,
    message: string,
    readonly statusCode = 503,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "RuntimeAdapterError";
  }
}

export function createOpenClawGatewayNotConfiguredError(): RuntimeAdapterError {
  return new RuntimeAdapterError(
    "openclaw_gateway_not_configured",
    "OpenClaw Gateway is not configured. Set OPENCLAW_GATEWAY_URL or add gateway settings to ~/.openclaw/openclaw.json. To use demo responses intentionally, set OPENCLAW_ADAPTER=mock."
  );
}

export function createOpenClawGatewayNotConnectedError(): RuntimeAdapterError {
  return new RuntimeAdapterError(
    "openclaw_gateway_not_connected",
    "OpenClaw Gateway is not connected. Start OpenClaw Gateway and retry the request."
  );
}

export function createOpenClawGatewayUnreachableError(error: unknown, url: string): RuntimeAdapterError {
  return new RuntimeAdapterError(
    "openclaw_gateway_unreachable",
    `OpenClaw Gateway could not be reached at ${url}. Start OpenClaw Gateway or fix OPENCLAW_GATEWAY_URL.`,
    503,
    error
  );
}

export function isRuntimeAdapterError(error: unknown): error is RuntimeAdapterError {
  return error instanceof RuntimeAdapterError;
}
