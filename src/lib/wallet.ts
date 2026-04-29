/**
 * Wallet integration and auth state.
 *
 * The council console has no backend -- auth means "wallet connected."
 * The wallet extension proves key ownership (it controls the private key).
 * We store the connected address in localStorage as the session.
 */
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/stellar-wallets-kit.mjs";
import { WalletNetwork } from "@creit.tech/stellar-wallets-kit/types.mjs";
import {
  FREIGHTER_ID,
  FreighterModule,
} from "@creit.tech/stellar-wallets-kit/modules/freighter.module.mjs";
import "@creit.tech/stellar-wallets-kit/components/modal/stellar-wallets-modal.mjs";
import { getNetworkPassphrase, STELLAR_NETWORK } from "./config.ts";
import { Buffer } from "node:buffer";

const STORAGE_KEY = "council_admin_address";

let kit: StellarWalletsKit | null = null;
let connectedAddress: string | null = null;

function getWalletNetwork(): WalletNetwork {
  switch (STELLAR_NETWORK) {
    case "mainnet":
      return WalletNetwork.PUBLIC;
    case "standalone":
      return WalletNetwork.STANDALONE;
    default:
      return WalletNetwork.TESTNET;
  }
}

function getKit(): StellarWalletsKit {
  if (!kit) {
    kit = new StellarWalletsKit({
      network: getWalletNetwork(),
      selectedWalletId: FREIGHTER_ID,
      modules: [new FreighterModule()],
    });
  }
  return kit;
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
export function connectWallet(): Promise<string> {
  const walletKit = getKit();

  return new Promise((resolve, reject) => {
    walletKit.openModal({
      onWalletSelected: async (option) => {
        walletKit.setWallet(option.id);
        try {
          const { address } = await walletKit.getAddress();
          connectedAddress = address;
          localStorage.setItem(STORAGE_KEY, address);
          resolve(address);
        } catch (err) {
          reject(err);
        }
      },
    }).catch(reject);
  });
}

/**
 * The StellarWalletsKit v1.x types don't include signMessage, but the
 * runtime implementation exposes it (delegates to the active module's
 * SEP-43 signMessage). This interface extends the kit with the method
 * signature matching the v2.x ModuleInterface contract.
 * See: https://github.com/Creit-Tech/Stellar-Wallets-Kit/blob/main/src/types/mod.ts
 */
interface WalletKitWithSignMessage {
  signMessage(
    message: string,
    opts: { address: string; networkPassphrase: string },
  ): Promise<SignMessageResult>;
}

interface SignMessageResult {
  signedMessage: string;
  signerAddress?: string;
  error?: string;
}

/**
 * Sign an arbitrary message with the connected wallet (SEP-53).
 * Used for challenge-response authentication with the council platform.
 */
export async function signMessage(message: string): Promise<string> {
  const walletKit = getKit() as unknown as WalletKitWithSignMessage;
  const address = getConnectedAddress();
  if (!address) throw new Error("Wallet not connected");

  const result = await walletKit.signMessage(message, {
    address,
    networkPassphrase: getNetworkPassphrase(),
  });

  if (result.error) throw new Error(result.error);
  if (typeof result.signedMessage === "string") return result.signedMessage;

  throw new Error("Unexpected signMessage response");
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
  const walletKit = getKit();
  const address = getConnectedAddress();
  if (!address) throw new Error("No wallet connected");

  const { signedTxXdr } = await walletKit.signTransaction(xdr, {
    address,
    networkPassphrase: getNetworkPassphrase(),
  });

  return signedTxXdr;
}
