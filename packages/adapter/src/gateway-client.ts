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

interface PendingSingleRequest {
  kind: "single";
  expectFinal: boolean;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout | undefined;
}

interface PendingLifecycleRequest {
  kind: "lifecycle";
  acceptedSettled: boolean;
  acceptedResolve: (value: unknown) => void;
  acceptedReject: (error: Error) => void;
  finalResolve: (value: unknown) => void;
  finalReject: (error: Error) => void;
  acceptedTimeout: NodeJS.Timeout | undefined;
  finalTimeout: NodeJS.Timeout | undefined;
}

type PendingRequest = PendingSingleRequest | PendingLifecycleRequest;
type GatewayEventHandler = (payload: unknown) => void;

export interface GatewayRequestLifecycle<T> {
  accepted: Promise<T>;
  final: Promise<T>;
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
  private eventHandlers = new Map<string, Set<GatewayEventHandler>>();

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
        kind: "single",
        expectFinal: opts?.expectFinal === true,
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
    });

    this.ws.send(JSON.stringify({ type: "req", id, method, params }));
    return promise;
  }

  requestLifecycle<T>(
    method: string,
    params?: unknown,
    opts?: { acceptedTimeoutMs?: number | null; finalTimeoutMs?: number | null },
  ): GatewayRequestLifecycle<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("OpenClaw Gateway is not connected.");
    }

    const id = randomUUID();
    let acceptedResolve!: (value: T) => void;
    let acceptedReject!: (error: Error) => void;
    let finalResolve!: (value: T) => void;
    let finalReject!: (error: Error) => void;

    const accepted = new Promise<T>((resolve, reject) => {
      acceptedResolve = resolve;
      acceptedReject = reject;
    });
    const final = new Promise<T>((resolve, reject) => {
      finalResolve = resolve;
      finalReject = reject;
    });
    // A lifecycle request can time out before callers attach a final handler.
    // Keep the original promise rejectable for consumers, but mark it handled so
    // a slow accepted frame cannot terminate the dev server with an unhandled rejection.
    void final.catch(() => undefined);

    const acceptedTimeout =
      opts?.acceptedTimeoutMs === null
        ? undefined
        : setTimeout(() => {
            const pending = this.pending.get(id);
            if (!pending || pending.kind !== "lifecycle" || pending.acceptedSettled) return;
            pending.acceptedSettled = true;
            const error = new Error(`OpenClaw Gateway request timeout for ${method}.`);
            acceptedReject(error);
          }, opts?.acceptedTimeoutMs ?? this.config.requestTimeoutMs);
    const finalTimeout =
      opts?.finalTimeoutMs === null
        ? undefined
        : setTimeout(() => {
            this.pending.delete(id);
            finalReject(new Error(`OpenClaw Gateway final response timeout for ${method}.`));
          }, opts?.finalTimeoutMs ?? this.config.requestTimeoutMs);

    this.pending.set(id, {
      kind: "lifecycle",
      acceptedSettled: false,
      acceptedResolve: (value) => acceptedResolve(value as T),
      acceptedReject,
      finalResolve: (value) => finalResolve(value as T),
      finalReject,
      acceptedTimeout,
      finalTimeout,
    });

    this.ws.send(JSON.stringify({ type: "req", id, method, params }));
    return { accepted, final };
  }

  onEvent(event: string, handler: GatewayEventHandler): () => void {
    const handlers = this.eventHandlers.get(event) ?? new Set<GatewayEventHandler>();
    handlers.add(handler);
    this.eventHandlers.set(event, handlers);
    return () => {
      const current = this.eventHandlers.get(event);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.eventHandlers.delete(event);
      }
    };
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
        return;
      }
      this.emitEvent(parsed.event, parsed.payload);
      return;
    }

    if (!isGatewayResponse(parsed)) return;

    const pending = this.pending.get(parsed.id);
    if (!pending) return;

    const status = readStatus(parsed.payload);

    if (pending.kind === "single") {
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
      return;
    }

    if (parsed.ok) {
      if (!pending.acceptedSettled) {
        pending.acceptedSettled = true;
        if (pending.acceptedTimeout) clearTimeout(pending.acceptedTimeout);
        pending.acceptedResolve(parsed.payload);
      }

      if (status === "accepted") {
        return;
      }

      this.pending.delete(parsed.id);
      if (pending.finalTimeout) clearTimeout(pending.finalTimeout);
      pending.finalResolve(parsed.payload);
      return;
    }

    this.pending.delete(parsed.id);
    if (pending.acceptedTimeout) clearTimeout(pending.acceptedTimeout);
    if (pending.finalTimeout) clearTimeout(pending.finalTimeout);
    const error = new GatewayRequestError(
      parsed.error?.message ?? "OpenClaw Gateway request failed.",
      parsed.error?.code,
      parsed.error?.details,
    );
    if (!pending.acceptedSettled) {
      pending.acceptedReject(error);
    }
    pending.finalReject(error);
  }

  private async sendConnect(payload: unknown): Promise<void> {
    const nonce =
      payload && typeof payload === "object" && typeof (payload as { nonce?: unknown }).nonce === "string"
        ? (payload as { nonce: string }).nonce
        : "";
    const client = {
      id: "openclaw-control-ui",
      version: "hiveward",
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
        userAgent: "hiveward-adapter",
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

  private emitEvent(event: string, payload: unknown): void {
    for (const handler of this.eventHandlers.get(event) ?? []) {
      handler(payload);
    }
    for (const handler of this.eventHandlers.get("*") ?? []) {
      handler({ event, payload });
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      if (pending.kind === "single") {
        if (pending.timeout) clearTimeout(pending.timeout);
        pending.reject(error);
        continue;
      }

      if (pending.acceptedTimeout) clearTimeout(pending.acceptedTimeout);
      if (pending.finalTimeout) clearTimeout(pending.finalTimeout);
      if (!pending.acceptedSettled) {
        pending.acceptedReject(error);
      }
      pending.finalReject(error);
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
