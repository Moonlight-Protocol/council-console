/**
 * Stellar/Soroban helpers for contract deployment and invocation.
 * All transactions are built unsigned and signed via wallet (Freighter).
 */
import { RPC_URL, HORIZON_URL, FRIENDBOT_URL, getNetworkPassphrase } from "./config.ts";

const NETWORK_PASSPHRASE = getNetworkPassphrase();

export { RPC_URL, HORIZON_URL, FRIENDBOT_URL, NETWORK_PASSPHRASE };

// Lazy-loaded SDK
// deno-lint-ignore no-explicit-any
let StellarSdk: any = null;

export async function sdk() {
  if (!StellarSdk) {
    StellarSdk = await import("stellar-sdk");
  }
  return StellarSdk;
}

export async function getRpcServer() {
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
  // deno-lint-ignore no-explicit-any
  const asset = release.assets.find((a: any) => a.name === wasmFileName);
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
      func: xdr.HostFunction.hostFunctionTypeUploadContractWasm(wasmBytes),
      auth: [],
    }))
    .setTimeout(300)
    .build();

  const sim = await server.simulateTransaction(tx);
  if ("error" in sim) {
    throw new Error(`WASM install simulation failed: ${sim.error}`);
  }
  const prepared = stellar.rpc.assembleTransaction(tx, sim).build();

  // Extract wasm hash from simulation result for later use
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
              salt: Buffer.from(salt),
            })
          ),
          executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.from(wasmHash)),
          constructorArgs: (constructorArgs as xdr.ScVal[]),
        })
      ),
      auth: [],
    }))
    .setTimeout(300)
    .build();

  const sim = await server.simulateTransaction(tx);
  if ("error" in sim) {
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
  if ("error" in sim) {
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

// deno-lint-ignore no-explicit-any
async function waitForTx(server: any, hash: string, timeoutMs = 60000): Promise<any> {
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

// deno-lint-ignore no-explicit-any
function extractContractIdFromEvents(txResult: any): string | null {
  try {
    const meta = txResult.resultMetaXdr;
    if (!meta) return null;
    const v3 = meta.v3();
    const events = v3.sorobanMeta()?.events() ?? [];
    for (const event of events) {
      const cId = event.contractId();
      if (cId) {
        const { StrKey } = StellarSdk;
        return StrKey.encodeContract(cId);
      }
    }
    return null;
  } catch {
    return null;
  }
}
