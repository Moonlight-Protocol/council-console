/**
 * Stellar/Soroban helpers for contract deployment and invocation.
 * All transactions are built unsigned and signed via wallet (Freighter).
 */
import { RPC_URL, HORIZON_URL, FRIENDBOT_URL, getNetworkPassphrase } from "./config.ts";

const NETWORK_PASSPHRASE = getNetworkPassphrase();

export { RPC_URL, HORIZON_URL, FRIENDBOT_URL, NETWORK_PASSPHRASE };

/** Subset of stellar-sdk used by this module. */
interface StellarSdkSubset {
  TransactionBuilder: {
    new (account: StellarAccount, opts: { fee: string; networkPassphrase: string }): TxBuilder;
    fromXDR(xdr: string, networkPassphrase: string): Transaction;
  };
  Operation: {
    invokeHostFunction(opts: { func: unknown; auth: unknown[] }): unknown;
  };
  Contract: new (id: string) => { call(fn: string, ...args: unknown[]): unknown };
  Address: { fromString(addr: string): { toScAddress(): unknown }; fromScVal(val: unknown): { toString(): string } };
  Asset: {
    native(): { contractId(passphrase: string): string };
    new (code: string, issuer: string): { contractId(passphrase: string): string };
  };
  StrKey: { encodeContract(bytes: Uint8Array): string; decodeEd25519PublicKey(key: string): Uint8Array; isValidEd25519PublicKey(key: string): boolean };
  Keypair: { fromSecret(secret: string): unknown; random(): unknown };
  nativeToScVal(value: unknown, opts?: { type: string }): unknown;
  xdr: XdrNamespace;
  rpc: {
    Server: new (url: string, opts?: { allowHttp?: boolean }) => RpcServer;
    assembleTransaction(tx: Transaction, sim: SimulationResult): { build(): Transaction };
  };
  hash(data: Uint8Array): Uint8Array;
}

interface XdrNamespace {
  HostFunction: {
    hostFunctionTypeUploadContractWasm(wasm: Uint8Array): unknown;
    hostFunctionTypeCreateContractV2(args: unknown): unknown;
  };
  CreateContractArgsV2: new (opts: {
    contractIdPreimage: unknown;
    executable: unknown;
    constructorArgs: unknown[];
  }) => unknown;
  ContractIdPreimage: {
    contractIdPreimageFromAddress(preimage: unknown): unknown;
  };
  ContractIdPreimageFromAddress: new (opts: {
    address: unknown;
    salt: unknown;
  }) => unknown;
  ContractExecutable: {
    contractExecutableWasm(hash: unknown): unknown;
  };
}

interface StellarAccount { sequenceNumber(): string }
interface TxBuilder {
  addOperation(op: unknown): TxBuilder;
  setTimeout(seconds: number): TxBuilder;
  build(): Transaction;
}
interface Transaction {
  toXDR(): string;
  sign(keypair: unknown): void;
}
interface RpcServer {
  getAccount(publicKey: string): Promise<StellarAccount>;
  simulateTransaction(tx: Transaction): Promise<SimulationResult>;
  sendTransaction(tx: Transaction): Promise<{ hash: string }>;
  getTransaction(hash: string): Promise<TxResult>;
  getLatestLedger(): Promise<{ sequence: number }>;
}
interface SimulationResult { error?: string }
interface TxResult {
  status: string;
  returnValue?: { address(): { contractId(): Uint8Array } };
  resultMetaXdr?: { v3(): { sorobanMeta(): { events(): SorobanEvent[] } | null } };
}
interface SorobanEvent { contractId(): Uint8Array | null }

let StellarSdk: StellarSdkSubset | null = null;
let RpcModule: { Server: new (url: string, opts?: { allowHttp?: boolean }) => RpcServer; assembleTransaction(tx: Transaction, sim: SimulationResult): { build(): Transaction } } | null = null;

export async function sdk(): Promise<StellarSdkSubset> {
  if (!StellarSdk) {
    StellarSdk = await import("stellar-sdk") as unknown as StellarSdkSubset;
  }
  return StellarSdk;
}

export async function rpc(): Promise<NonNullable<typeof RpcModule>> {
  if (!RpcModule) {
    const s = await sdk();
    RpcModule = s.rpc;
  }
  return RpcModule!;
}

export async function getRpcServer(): Promise<RpcServer> {
  const { Server } = await rpc();
  return new Server(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") });
}

export async function fundAccount(publicKey: string): Promise<void> {
  const res = await fetch(`${FRIENDBOT_URL}?addr=${publicKey}`);
  if (!res.ok) {
    throw new Error(`Friendbot funding failed: ${res.status} ${await res.text()}`);
  }
}

/**
 * Load WASM binary from the bundled /wasm/ directory.
 * WASMs are downloaded from soroban-core at build time (see build.ts).
 */
export async function fetchWasm(contractName: string): Promise<Uint8Array> {
  const res = await fetch(`/wasm/${contractName}.wasm`);
  if (!res.ok) {
    throw new Error(`Failed to load ${contractName}.wasm (${res.status}). Was the build run?`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Build and simulate a WASM install transaction.
 * Returns the XDR string for wallet signing.
 */
export async function buildInstallWasmTx(
  wasmBytes: Uint8Array,
  sourcePublicKey: string,
): Promise<{ xdr: string; wasmHash: Uint8Array }> {
  const stellar = await sdk();
  const { TransactionBuilder, Operation, xdr } = stellar;
  const server = await getRpcServer();

  const account = await server.getAccount(sourcePublicKey);
  const tx = new TransactionBuilder(account, {
    fee: "10000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeUploadContractWasm(wasmBytes),
      auth: [],
    }))
    .setTimeout(300)
    .build();

  const sim = await server.simulateTransaction(tx);
  if ("error" in sim && sim.error) {
    throw new Error(`WASM install simulation failed: ${sim.error}`);
  }
  const { assembleTransaction } = await rpc();
  const prepared = assembleTransaction(tx, sim).build();
  const hashBuffer = stellar.hash(wasmBytes);

  return { xdr: prepared.toXDR(), wasmHash: hashBuffer };
}

/**
 * Build and simulate a contract deploy transaction.
 * Returns the XDR string for wallet signing.
 */
/**
 * Compute a deterministic salt for contract deployment.
 * salt = SHA-256(channelAuthId + ":" + assetCode + ":" + issuerAddress + ":" + suffix)
 * Including the issuer prevents collisions when two tokens share the same code
 * (e.g. two different USDC issuers). For native XLM, issuer is empty string.
 * Suffix is reserved for future use (e.g. version, sequence).
 */
export async function computeDeploySalt(channelAuthId: string, assetCode: string, issuerAddress = "", suffix = ""): Promise<Uint8Array> {
  const data = new TextEncoder().encode(`${channelAuthId}:${assetCode}:${issuerAddress}:${suffix}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(hash);
}

/**
 * Derive the expected contract address from deployer + wasm hash + salt.
 * Replicates Stellar's contractIdPreimageFromAddress derivation.
 */
export async function deriveContractAddress(
  deployerPublicKey: string,
  salt: Uint8Array,
): Promise<string> {
  const stellar = await sdk();
  const { Address, StrKey } = stellar;

  // The contract ID is SHA-256 of the XDR-encoded HashIDPreimage:
  //   ENVELOPE_TYPE_CONTRACT_ID (4 bytes, value 40)
  //   + network_id (32 bytes = SHA-256 of network passphrase)
  //   + ContractIdPreimage discriminant (4 bytes, FROM_ADDRESS = 0)
  //   + ScAddress discriminant (4 bytes, SC_ADDRESS_TYPE_ACCOUNT = 0)
  //   + PublicKeyType discriminant (4 bytes, PUBLIC_KEY_TYPE_ED25519 = 0)
  //   + ed25519 public key (32 bytes)
  //   + salt (32 bytes)
  // Total: 4 + 32 + 4 + 4 + 4 + 32 + 32 = 112 bytes
  const passphraseHash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(NETWORK_PASSPHRASE)));
  const deployerBytes = StrKey.decodeEd25519PublicKey(deployerPublicKey);

  const preimage = new Uint8Array(112);
  let offset = 0;
  // ENVELOPE_TYPE_CONTRACT_ID = 37 (0x25) per Stellar XDR spec
  preimage[3] = 37; offset += 4;
  // network_id
  preimage.set(passphraseHash, offset); offset += 32;
  // CONTRACT_ID_PREIMAGE_FROM_ADDRESS = 0 (already zeroed)
  offset += 4;
  // SC_ADDRESS_TYPE_ACCOUNT = 0 (already zeroed)
  offset += 4;
  // PUBLIC_KEY_TYPE_ED25519 = 0 (already zeroed)
  offset += 4;
  // ed25519 key
  preimage.set(deployerBytes, offset); offset += 32;
  // salt
  preimage.set(salt, offset);

  const contractHash = new Uint8Array(await crypto.subtle.digest("SHA-256", preimage));
  return StrKey.encodeContract(contractHash);
}

export async function buildDeployContractTx(
  wasmHash: Uint8Array,
  sourcePublicKey: string,
  constructorArgs: unknown[],
  salt?: Uint8Array,
): Promise<string> {
  const stellar = await sdk();
  const { TransactionBuilder, Operation, xdr, Address } = stellar;
  const server = await getRpcServer();

  const account = await server.getAccount(sourcePublicKey);
  const deploySalt = salt ?? crypto.getRandomValues(new Uint8Array(32));

  const tx = new TransactionBuilder(account, {
    fee: "10000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeCreateContractV2(
        new xdr.CreateContractArgsV2({
          contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
            new xdr.ContractIdPreimageFromAddress({
              address: Address.fromString(sourcePublicKey).toScAddress(),
              salt: Buffer.from(deploySalt),
            })
          ),
          executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.from(wasmHash)),
          constructorArgs,
        })
      ),
      auth: [],
    }))
    .setTimeout(300)
    .build();

  const sim = await server.simulateTransaction(tx);
  if ("error" in sim && sim.error) {
    throw new Error(`Deploy simulation failed: ${sim.error}`);
  }
  const { assembleTransaction } = await rpc();
  const prepared = assembleTransaction(tx, sim).build();
  return prepared.toXDR();
}

/**
 * Build and simulate a contract invocation transaction.
 * Returns the XDR string for wallet signing.
 */
export async function buildInvokeContractTx(
  contractId: string,
  functionName: string,
  args: unknown[],
  sourcePublicKey: string,
): Promise<string> {
  const stellar = await sdk();
  const { TransactionBuilder, Contract } = stellar;
  const server = await getRpcServer();

  const account = await server.getAccount(sourcePublicKey);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: "10000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(functionName, ...args))
    .setTimeout(300)
    .build();

  const sim = await server.simulateTransaction(tx);
  if ("error" in sim && sim.error) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }
  const { assembleTransaction } = await rpc();
  const prepared = assembleTransaction(tx, sim).build();
  return prepared.toXDR();
}

/**
 * Submit a signed transaction XDR and wait for confirmation.
 */
export async function submitTx(signedXdr: string): Promise<{ contractId: string | null }> {
  const stellar = await sdk();
  const { TransactionBuilder } = stellar;
  const server = await getRpcServer();

  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const result = await server.sendTransaction(tx);
  const status = await waitForTx(server, result.hash);

  if (status.status !== "SUCCESS") {
    throw new Error(`Transaction failed: ${status.status}`);
  }

  const contractId = extractContractIdFromEvents(status);
  return { contractId };
}

/**
 * Resolve the Stellar Asset Contract address for a given asset.
 */
export async function getAssetContractId(assetCode: string, assetIssuer?: string): Promise<string> {
  const stellar = await sdk();
  const { Asset } = stellar;

  const asset = (!assetIssuer || assetCode === "XLM")
    ? Asset.native()
    : new Asset(assetCode, assetIssuer);

  return asset.contractId(NETWORK_PASSPHRASE);
}

/**
 * Query the admin's native XLM balance via Horizon.
 */
export async function getAccountBalance(publicKey: string): Promise<{ xlm: string; funded: boolean }> {
  try {
    const res = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
    if (res.status === 404) return { xlm: "0", funded: false };
    if (!res.ok) return { xlm: "0", funded: false };
    const data = await res.json();
    const native = data.balances?.find(
      (b: { asset_type: string; balance: string }) => b.asset_type === "native",
    );
    return { xlm: native?.balance ?? "0", funded: true };
  } catch {
    return { xlm: "0", funded: false };
  }
}

async function waitForTx(server: RpcServer, hash: string, timeoutMs = 60000): Promise<TxResult> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await server.getTransaction(hash);
    if (status.status !== "NOT_FOUND") {
      return status;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Transaction ${hash} timed out`);
}

function extractContractIdFromEvents(txResult: TxResult): string | null {
  try {
    // Try returnValue first (deploy returns the contract address)
    const rv = txResult.returnValue;
    if (rv) {
      try {
        const addr = rv.address();
        if (addr) {
          const contractBytes = addr.contractId();
          return StellarSdk!.StrKey.encodeContract(contractBytes);
        }
      } catch { /* not an address return value */ }
    }

    const meta = txResult.resultMetaXdr;
    if (!meta) return null;
    const events = meta.v3().sorobanMeta()?.events() ?? [];
    for (const event of events) {
      const cId = event.contractId();
      if (cId) return StellarSdk!.StrKey.encodeContract(cId);
    }
    return null;
  } catch {
    return null;
  }
}
