/**
 * Wallet integration and auth state.
 *
 * The council console has no backend -- auth means "wallet connected."
 * The wallet extension proves key ownership (it controls the private key).
 * We store the connected address in localStorage as the session.
 *
 * Uses stellar-wallets-kit v2 (static API).
 */
// deno-lint-ignore-file no-node-globals -- Buffer is provided at runtime by src/shims/buffer.ts via esbuild inject; importing it from "node:buffer" survives the build.ts strip and breaks the browser bundle under CSP.
import { StellarWalletsKit } from "@creit-tech/stellar-wallets-kit/sdk";
import { Networks } from "@creit-tech/stellar-wallets-kit/types";
import { FreighterModule } from "@creit-tech/stellar-wallets-kit/modules/freighter";
import { getNetworkPassphrase, STELLAR_NETWORK } from "./config.ts";

const STORAGE_KEY = "council_admin_address";

let initialized = false;
let connectedAddress: string | null = null;

function getWalletNetwork(): Networks {
  switch (STELLAR_NETWORK) {
    case "mainnet":
      return Networks.PUBLIC;
    case "standalone":
      return Networks.STANDALONE;
    default:
      return Networks.TESTNET;
  }
}

function ensureInit(): void {
  if (!initialized) {
    StellarWalletsKit.init({
      modules: [new FreighterModule()],
      network: getWalletNetwork(),
    });
    initialized = true;
  }
  if (getConnectedAddress()) {
    StellarWalletsKit.setWallet("freighter");
  }
}

export function getConnectedAddress(): string | null {
  if (!connectedAddress) {
    connectedAddress = localStorage.getItem(STORAGE_KEY);
  }
  return connectedAddress;
}

export function isAuthenticated(): boolean {
  return !!getConnectedAddress();
}

// --- Master seed (sessionStorage — persists across refreshes, cleared on tab close) ---
const SEED_KEY = "master_seed";
let masterSeed: Uint8Array | null = null;

// Restore from sessionStorage on module load
{
  const stored = sessionStorage.getItem(SEED_KEY);
  if (stored) {
    try {
      masterSeed = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
    } catch {
      // Corrupted base64 — clear and proceed without seed
      sessionStorage.removeItem(SEED_KEY);
      masterSeed = null;
    }
  }
}

/**
 * Derive the master seed from a single wallet signature.
 * Must be called once per session before any key derivation.
 */
export async function initMasterSeed(): Promise<void> {
  const signature = await signMessage("Moonlight: authorize master key");
  const normalized = signature.replace(/-/g, "+").replace(/_/g, "/");
  const sigBytes = Uint8Array.from(atob(normalized), (c) => c.charCodeAt(0));
  masterSeed = new Uint8Array(await crypto.subtle.digest("SHA-256", sigBytes));
  sessionStorage.setItem(SEED_KEY, btoa(String.fromCharCode(...masterSeed)));
}

export function getMasterSeed(): Uint8Array {
  if (!masterSeed) {
    throw new Error("Master seed not initialized. Sign in first.");
  }
  return masterSeed;
}

export function isMasterSeedReady(): boolean {
  return masterSeed !== null;
}

export function clearSession(): void {
  connectedAddress = null;
  masterSeed = null;
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(SEED_KEY);
}

/**
 * Open wallet modal, connect, and store the admin address.
 * Returns the public key.
 */
export async function connectWallet(): Promise<string> {
  ensureInit();
  const { address } = await StellarWalletsKit.authModal();
  connectedAddress = address;
  localStorage.setItem(STORAGE_KEY, address);
  return address;
}

/**
 * Sign an arbitrary message with the connected wallet (SEP-53).
 * Used for challenge-response authentication with the council platform.
 */
export async function signMessage(message: string): Promise<string> {
  ensureInit();
  const address = getConnectedAddress();
  if (!address) throw new Error("Wallet not connected");

  const result = await StellarWalletsKit.signMessage(message, {
    address,
    networkPassphrase: getNetworkPassphrase(),
  });

  if (
    typeof result?.signedMessage !== "string" ||
    result.signedMessage.length === 0
  ) {
    throw new Error("Wallet returned an empty signature");
  }
  return result.signedMessage;
}

/**
 * Derive a deterministic OpEx (treasury) keypair from the master seed.
 * SHA-256(masterSeed + "opex" + index) → Ed25519 seed.
 * No wallet interaction — pure math.
 *
 * NOTE: The returned secretKey is a JS string and cannot be zeroed from memory.
 * This is a known limitation of JS string immutability — there is no way to
 * clear it after use. Callers should avoid persisting it unnecessarily.
 */
export async function deriveOpExKeypair(
  index: number,
): Promise<{ publicKey: string; secretKey: string }> {
  const seed = getMasterSeed();
  const encoder = new TextEncoder();
  const input = new Uint8Array([
    ...seed,
    ...encoder.encode("opex"),
    ...encoder.encode(String(index)),
  ]);
  const derived = new Uint8Array(await crypto.subtle.digest("SHA-256", input));

  const { Keypair } = await import("stellar-sdk");
  // stellar-sdk's fromRawEd25519Seed expects a Buffer, but we have a Uint8Array.
  // The double cast is needed because the types are incompatible at compile time,
  // even though Uint8Array is accepted at runtime.
  const keypair = Keypair.fromRawEd25519Seed(derived as unknown as Buffer);
  return { publicKey: keypair.publicKey(), secretKey: keypair.secret() };
}

/**
 * Derive a deterministic council keypair from the master seed.
 * SHA-256(masterSeed + "council" + index) → Ed25519 seed.
 * No wallet interaction — pure math.
 *
 * NOTE: The returned secretKey is a JS string and cannot be zeroed from memory.
 * This is a known limitation of JS string immutability — there is no way to
 * clear it after use. Callers should avoid persisting it unnecessarily.
 */
export async function deriveCouncilKeypair(
  index: number,
): Promise<{ publicKey: string; secretKey: string }> {
  const seed = getMasterSeed();
  const encoder = new TextEncoder();
  const input = new Uint8Array([
    ...seed,
    ...encoder.encode("council"),
    ...encoder.encode(String(index)),
  ]);
  const derived = new Uint8Array(await crypto.subtle.digest("SHA-256", input));

  const { Keypair } = await import("stellar-sdk");
  // stellar-sdk's fromRawEd25519Seed expects a Buffer, but we have a Uint8Array.
  // The double cast is needed because the types are incompatible at compile time,
  // even though Uint8Array is accepted at runtime.
  const keypair = Keypair.fromRawEd25519Seed(derived as unknown as Buffer);
  return { publicKey: keypair.publicKey(), secretKey: keypair.secret() };
}

/**
 * Sign a transaction XDR with the connected wallet.
 */
export async function signTransaction(xdr: string): Promise<string> {
  ensureInit();
  const address = getConnectedAddress();
  if (!address) throw new Error("No wallet connected");

  const { signedTxXdr } = await StellarWalletsKit.signTransaction(xdr, {
    address,
    networkPassphrase: getNetworkPassphrase(),
  });

  return signedTxXdr;
}
