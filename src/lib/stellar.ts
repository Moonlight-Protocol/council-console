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
  Address: { fromString(addr: string): { toScAddress(): unknown } };
  Asset: {
    native(): { contractId(passphrase: string): string };
    new (code: string, issuer: string): { contractId(passphrase: string): string };
  };
  StrKey: { encodeContract(bytes: Uint8Array): string; isValidEd25519PublicKey(key: string): boolean };
  Keypair: { fromSecret(secret: string): unknown; random(): unknown };
  nativeToScVal(value: unknown, opts?: { type: string }): unknown;
  xdr: Record<string, unknown>;
  rpc: {
    Server: new (url: string, opts?: { allowHttp?: boolean }) => RpcServer;
    assembleTransaction(tx: Transaction, sim: SimulationResult): { build(): Transaction };
  };
  hash(data: Uint8Array): Uint8Array;
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

export async function sdk(): Promise<StellarSdkSubset> {
  if (!StellarSdk) {
    StellarSdk = await import("stellar-sdk") as unknown as StellarSdkSubset;
  }
  return StellarSdk;
}

export async function getRpcServer(): Promise<RpcServer> {
  const { rpc } = await sdk();
  return new rpc.Server(RPC_URL);
}

export async function fundAccount(publicKey: string): Promise<void> {
  const res = await fetch(`${FRIENDBOT_URL}?addr=${publicKey}`);
  if (!res.ok) {
    throw new Error(`Friendbot funding failed: ${res.status} ${await res.text()}`);
  }
}

/**
 * Fetch WASM binary from soroban-core GitHub release.
 */
export async function fetchWasmFromRelease(
  contractName: string,
  version = "latest",
): Promise<Uint8Array> {
  const baseUrl = "https://api.github.com/repos/Moonlight-Protocol/soroban-core/releases";
  const releaseUrl = version === "latest" ? `${baseUrl}/latest` : `${baseUrl}/tags/${version}`;

  const releaseRes = await fetch(releaseUrl);
  if (!releaseRes.ok) {
    throw new Error(`Failed to fetch release: ${releaseRes.status}`);
  }
  const release = await releaseRes.json();

  const wasmFileName = `${contractName}.wasm`;
  const asset = release.assets.find((a: { name: string }) => a.name === wasmFileName);
  if (!asset) {
    const available = release.assets.map((a: { name: string }) => a.name).join(", ");
    throw new Error(`WASM "${wasmFileName}" not found in release. Available: ${available}`);
  }

  const wasmRes = await fetch(asset.browser_download_url);
  if (!wasmRes.ok) {
    throw new Error(`Failed to download WASM: ${wasmRes.status}`);
  }
  return new Uint8Array(await wasmRes.arrayBuffer());
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
      func: (xdr as Record<string, unknown>).HostFunction
        ? (stellar.xdr as { HostFunction: { hostFunctionTypeUploadContractWasm(w: Uint8Array): unknown } })
            .HostFunction.hostFunctionTypeUploadContractWasm(wasmBytes)
        : undefined,
      auth: [],
    }))
    .setTimeout(300)
    .build();

  const sim = await server.simulateTransaction(tx);
  if ("error" in sim && sim.error) {
    throw new Error(`WASM install simulation failed: ${sim.error}`);
  }
  const prepared = stellar.rpc.assembleTransaction(tx, sim).build();
  const hashBuffer = stellar.hash(wasmBytes);

  return { xdr: prepared.toXDR(), wasmHash: hashBuffer };
}

/**
 * Build and simulate a contract deploy transaction.
 * Returns the XDR string for wallet signing.
 */
export async function buildDeployContractTx(
  wasmHash: Uint8Array,
  sourcePublicKey: string,
  constructorArgs: unknown[],
): Promise<string> {
  const stellar = await sdk();
  const { TransactionBuilder, Operation, xdr, Address } = stellar;
  const server = await getRpcServer();

  const account = await server.getAccount(sourcePublicKey);
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const xdrNs = xdr as Record<string, new (...args: unknown[]) => unknown> & {
    HostFunction: { hostFunctionTypeCreateContractV2(args: unknown): unknown };
    CreateContractArgsV2: new (opts: unknown) => unknown;
    ContractIdPreimage: { contractIdPreimageFromAddress(opts: unknown): unknown };
    ContractIdPreimageFromAddress: new (opts: unknown) => unknown;
    ContractExecutable: { contractExecutableWasm(hash: unknown): unknown };
    ScVal: unknown;
  };

  const tx = new TransactionBuilder(account, {
    fee: "10000000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.invokeHostFunction({
      func: xdrNs.HostFunction.hostFunctionTypeCreateContractV2(
        new xdrNs.CreateContractArgsV2({
          contractIdPreimage: xdrNs.ContractIdPreimage.contractIdPreimageFromAddress(
            new xdrNs.ContractIdPreimageFromAddress({
              address: Address.fromString(sourcePublicKey).toScAddress(),
              salt: Buffer.from(salt),
            })
          ),
          executable: xdrNs.ContractExecutable.contractExecutableWasm(Buffer.from(wasmHash)),
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
  const prepared = stellar.rpc.assembleTransaction(tx, sim).build();
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
  const prepared = stellar.rpc.assembleTransaction(tx, sim).build();
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
