import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { GatewayAdapterConfig } from "./gateway-config";
import { loadOrCreateGatewayDeviceIdentity, signGatewayDevice } from "./gateway-device";

interface GatewayResponseFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

interface GatewayEventFrame {
  type: "event";
  event: string;
  payload?: unknown;
}

interface PendingRequest {
  expectFinal: boolean;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout | undefined;
}

export class GatewayRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "GatewayRequestError";
  }
}

export class GatewaySession {
  private ws: WebSocket | undefined;
  private pending = new Map<string, PendingRequest>();
  private connected = false;
  private connectResolve: (() => void) | undefined;
  private connectReject: ((error: Error) => void) | undefined;
  private connectTimer: NodeJS.Timeout | undefined;

  constructor(private readonly config: GatewayAdapterConfig) {}

  async connect(): Promise<void> {
    if (this.connected) return;

    await new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      this.connectTimer = setTimeout(
        () => reject(new Error(`OpenClaw Gateway connect timeout: ${this.config.url}`)),
        this.config.requestTimeoutMs,
      );

      this.ws = new WebSocket(this.config.url, {
        headers: {
          Origin: this.config.origin,
        },
      });
      this.ws.on("message", (data) => void this.handleMessage(String(data)));
      this.ws.on("error", (error) => this.failConnect(error));
      this.ws.on("close", () => {
        this.connected = false;
        this.rejectPending(new Error("OpenClaw Gateway connection closed."));
      });
    });
  }

  async request<T>(
    method: string,
    params?: unknown,
    opts?: { expectFinal?: boolean; timeoutMs?: number | null },
  ): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("OpenClaw Gateway is not connected.");
    }

    const id = randomUUID();
    const timeoutMs = opts?.timeoutMs === null ? null : (opts?.timeoutMs ?? this.config.requestTimeoutMs);
    const promise = new Promise<T>((resolve, reject) => {
      const timeout =
        timeoutMs === null
          ? undefined
          : setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`OpenClaw Gateway request timeout for ${method}.`));
            }, timeoutMs);
      this.pending.set(id, {
        expectFinal: opts?.expectFinal === true,
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
    });

    this.ws.send(JSON.stringify({ type: "req", id, method, params }));
    return promise;
  }

  close(): void {
    this.ws?.close();
    this.ws = undefined;
    this.connected = false;
    this.rejectPending(new Error("OpenClaw Gateway session closed."));
  }

  private async handleMessage(raw: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (isGatewayEvent(parsed)) {
      if (parsed.event === "connect.challenge") {
        await this.sendConnect(parsed.payload);
      }
      return;
    }

    if (!isGatewayResponse(parsed)) return;

    const pending = this.pending.get(parsed.id);
    if (!pending) return;

    const status = readStatus(parsed.payload);
    if (parsed.ok && pending.expectFinal && status === "accepted") {
      return;
    }

    this.pending.delete(parsed.id);
    if (pending.timeout) clearTimeout(pending.timeout);

    if (parsed.ok) {
      pending.resolve(parsed.payload);
      return;
    }

    pending.reject(
      new GatewayRequestError(
        parsed.error?.message ?? "OpenClaw Gateway request failed.",
        parsed.error?.code,
        parsed.error?.details,
      ),
    );
  }

  private async sendConnect(payload: unknown): Promise<void> {
    const nonce =
      payload && typeof payload === "object" && typeof (payload as { nonce?: unknown }).nonce === "string"
        ? (payload as { nonce: string }).nonce
        : "";
    const client = {
      id: "openclaw-control-ui",
      version: "openclaw-cui",
      platform: process.platform,
      mode: "backend",
    };
    const role = "operator";
    const scopes = [
      "operator.admin",
      "operator.read",
      "operator.write",
      "operator.approvals",
      "operator.pairing",
    ];
    const identity = await loadOrCreateGatewayDeviceIdentity();
    const device = await signGatewayDevice(identity, {
      clientId: client.id,
      clientMode: client.mode,
      role,
      scopes,
      token: this.config.token,
      nonce,
    });

    try {
      await this.request("connect", {
        minProtocol: 4,
        maxProtocol: 4,
        client,
        role,
        scopes,
        caps: ["tool-events"],
        device,
        auth:
          this.config.token || this.config.password
            ? {
                token: this.config.token,
                password: this.config.password,
              }
            : undefined,
        userAgent: "openclaw-cui-adapter",
        locale: this.config.locale,
      });
      this.connected = true;
      if (this.connectTimer) clearTimeout(this.connectTimer);
      this.connectResolve?.();
    } catch (error) {
      this.failConnect(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private failConnect(error: Error): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectReject?.(error);
    this.rejectPending(error);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function isGatewayEvent(value: unknown): value is GatewayEventFrame {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { type?: unknown }).type === "event" &&
      typeof (value as { event?: unknown }).event === "string",
  );
}

function isGatewayResponse(value: unknown): value is GatewayResponseFrame {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { type?: unknown }).type === "res" &&
      typeof (value as { id?: unknown }).id === "string",
  );
}

function readStatus(payload: unknown): string | undefined {
  return payload && typeof payload === "object" && typeof (payload as { status?: unknown }).status === "string"
    ? (payload as { status: string }).status
    : undefined;
}
