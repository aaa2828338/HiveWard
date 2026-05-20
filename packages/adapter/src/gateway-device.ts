import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";

export interface GatewayDeviceIdentity {
  version: 1;
  deviceId: string;
  publicKey: string;
  privateKey: string;
  createdAtMs: number;
}

export interface SignedGatewayDevice {
  id: string;
  publicKey: string;
  signature: string;
  signedAt: number;
  nonce: string;
}

export interface GatewayDeviceSignInput {
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  token?: string;
  nonce: string;
}

const defaultIdentityPath = resolve(homedir(), ".hiveward", "device-identity.json");

export async function loadOrCreateGatewayDeviceIdentity(
  filePath = process.env.HIVEWARD_DEVICE_IDENTITY_FILE ?? defaultIdentityPath,
): Promise<GatewayDeviceIdentity> {
  const existing = await readIdentity(filePath);
  if (existing) return existing;

  const privateKey = utils.randomSecretKey();
  const publicKey = await getPublicKeyAsync(privateKey);
  const identity: GatewayDeviceIdentity = {
    version: 1,
    deviceId: createHash("sha256").update(publicKey).digest("hex"),
    publicKey: base64UrlEncode(publicKey),
    privateKey: base64UrlEncode(privateKey),
    createdAtMs: Date.now(),
  };

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(identity, null, 2)}\n`, "utf8");
  return identity;
}

export async function signGatewayDevice(
  identity: GatewayDeviceIdentity,
  input: GatewayDeviceSignInput,
): Promise<SignedGatewayDevice> {
  const signedAt = Date.now();
  const payload = buildDeviceAuthPayload({
    deviceId: identity.deviceId,
    clientId: input.clientId,
    clientMode: input.clientMode,
    role: input.role,
    scopes: input.scopes,
    signedAtMs: signedAt,
    token: input.token,
    nonce: input.nonce,
  });
  const signature = await signAsync(
    new TextEncoder().encode(payload),
    base64UrlDecode(identity.privateKey),
  );
  return {
    id: identity.deviceId,
    publicKey: identity.publicKey,
    signature: base64UrlEncode(signature),
    signedAt,
    nonce: input.nonce,
  };
}

function buildDeviceAuthPayload(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token?: string;
  nonce: string;
}): string {
  return [
    "v2",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
    params.nonce,
  ].join("|");
}

async function readIdentity(filePath: string): Promise<GatewayDeviceIdentity | undefined> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<GatewayDeviceIdentity>;
    if (
      parsed.version === 1 &&
      typeof parsed.deviceId === "string" &&
      typeof parsed.publicKey === "string" &&
      typeof parsed.privateKey === "string" &&
      typeof parsed.createdAtMs === "number"
    ) {
      return parsed as GatewayDeviceIdentity;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function base64UrlDecode(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

export function createGatewayId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}
