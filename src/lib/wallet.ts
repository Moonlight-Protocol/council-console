/**
 * Wallet integration and auth state.
 *
 * The council console has no backend -- auth means "wallet connected."
 * The wallet extension proves key ownership (it controls the private key).
 * We store the connected address in localStorage as the session.
 */
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/stellar-wallets-kit.mjs";
import { WalletNetwork } from "@creit.tech/stellar-wallets-kit/types.mjs";
import { FreighterModule, FREIGHTER_ID } from "@creit.tech/stellar-wallets-kit/modules/freighter.module.mjs";
import "@creit.tech/stellar-wallets-kit/components/modal/stellar-wallets-modal.mjs";
import { STELLAR_NETWORK, getNetworkPassphrase } from "./config.ts";

const STORAGE_KEY = "council_admin_address";

let kit: StellarWalletsKit | null = null;
let connectedAddress: string | null = null;

function getWalletNetwork(): WalletNetwork {
  switch (STELLAR_NETWORK) {
    case "mainnet": return WalletNetwork.PUBLIC;
    case "standalone": return WalletNetwork.STANDALONE;
    default: return WalletNetwork.TESTNET;
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

export function clearSession(): void {
  connectedAddress = null;
  localStorage.removeItem(STORAGE_KEY);
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
