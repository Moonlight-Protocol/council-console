/**
 * Integration test for the full council deployment flow.
 *
 * Runs against local infrastructure (local-dev/up.sh):
 * - Local Stellar network at localhost:8000
 * - Friendbot at localhost:8000/friendbot
 *
 * Tests:
 * 1. Install + deploy Channel Auth contract
 * 2. Install + deploy Privacy Channel contract (linked to Channel Auth + native XLM SAC)
 * 3. Add a provider to the Channel Auth
 * 4. Remove the provider
 *
 * Prerequisites:
 *   ./up.sh in local-dev (Stellar network running)
 *
 * Run with: deno test --allow-all tests/deploy_test.ts
 */
import { assertEquals, assertExists } from "jsr:@std/assert";
import { resolve } from "jsr:@std/path";
import { Buffer } from "buffer";

const RPC_URL = Deno.env.get("STELLAR_RPC_URL") ?? "http://localhost:8000/soroban/rpc";
const FRIENDBOT_URL = Deno.env.get("FRIENDBOT_URL") ?? "http://localhost:8000/friendbot";
const NETWORK_PASSPHRASE = "Standalone Network ; February 2017";

// WASM_DIR: directory with pre-built .wasm files (from GitHub releases)
// Falls back to soroban-core build output for local dev
const WASM_DIR = Deno.env.get("WASM_DIR");
const SOROBAN_CORE_PATH = Deno.env.get("SOROBAN_CORE_PATH")
  ?? resolve(Deno.env.get("HOME") ?? "", "repos/soroban-core");

// deno-lint-ignore no-explicit-any
let stellar: any;

async function loadSdk() {
  if (!stellar) {
    stellar = await import("stellar-sdk");
  }
  return stellar;
}

async function getRpcServer() {
  const { rpc } = await loadSdk();
  return new rpc.Server(RPC_URL, { allowHttp: true });
}

async function fundAccount(publicKey: string) {
  const res = await fetch(`${FRIENDBOT_URL}?addr=${publicKey}`);
  if (!res.ok) throw new Error(`Friendbot failed: ${res.status}`);
}

async function loadWasm(contractName: string): Promise<Uint8Array> {
  // Try WASM_DIR first (pre-built from GitHub releases), then soroban-core build output
  const candidates = WASM_DIR
    ? [resolve(WASM_DIR, `${contractName}.wasm`)]
    : [
        resolve(SOROBAN_CORE_PATH, "target/wasm32v1-none/release", `${contractName}.wasm`),
      ];

  for (const path of candidates) {
    try {
      return await Deno.readFile(path);
    } catch { /* try next */ }
  }

  throw new Error(
    `WASM "${contractName}.wasm" not found. Set WASM_DIR to a directory with release WASMs, or build soroban-core locally.`,
  );
}

// deno-lint-ignore no-explicit-any
async function waitForTx(server: any, hash: string): Promise<any> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const status = await server.getTransaction(hash);
    if (status.status !== "NOT_FOUND") return status;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Transaction ${hash} timed out`);
}

// deno-lint-ignore no-explicit-any
async function buildSimulateSign(txBuilder: any, signer: any, server: any) {
  const tx = txBuilder.setTimeout(300).build();
  const sim = await server.simulateTransaction(tx);
  if ("error" in sim) throw new Error(`Simulation failed: ${sim.error}`);
  const { rpc } = await loadSdk();
  const prepared = rpc.assembleTransaction(tx, sim).build();
  prepared.sign(signer);
  const result = await server.sendTransaction(prepared);
  return waitForTx(server, result.hash);
}

// deno-lint-ignore no-explicit-any
function extractContractId(txResult: any): string | null {
  try {
    // Try returnValue first (deploy returns the contract address)
    const rv = txResult.returnValue;
    if (rv) {
      try {
        const addr = rv.address();
        if (addr) {
          const contractBytes = addr.contractId();
          return stellar.StrKey.encodeContract(contractBytes);
        }
      } catch { /* not an address return value */ }
    }

    // Fallback: scan events for contract ID
    const events = txResult.resultMetaXdr?.v3()?.sorobanMeta()?.events() ?? [];
    for (const event of events) {
      const cId = event.contractId();
      if (cId) return stellar.StrKey.encodeContract(cId);
    }
    return null;
  } catch {
    return null;
  }
}

Deno.test({
  name: "deploy flow: Channel Auth + Privacy Channel + add/remove provider",
  async fn() {
    const sdk = await loadSdk();
    const { Keypair, TransactionBuilder, Operation, xdr, Address, nativeToScVal, Contract } = sdk;
    const server = await getRpcServer();

    // Generate fresh keypairs
    const admin = Keypair.random();
    const provider = Keypair.random();
    console.log(`  Admin:    ${admin.publicKey()}`);
    console.log(`  Provider: ${provider.publicKey()}`);

    // Fund admin
    console.log("  Funding admin...");
    await fundAccount(admin.publicKey());

    // Load WASMs from local build
    console.log("  Loading WASMs...");
    const authWasm = await loadWasm("channel_auth_contract");
    const channelWasm = await loadWasm("privacy_channel");

    // --- Step 1: Install Channel Auth WASM ---
    console.log("  Installing Channel Auth WASM...");
    const account1 = await server.getAccount(admin.publicKey());
    const installAuthResult = await buildSimulateSign(
      new TransactionBuilder(account1, { fee: "10000000", networkPassphrase: NETWORK_PASSPHRASE })
        .addOperation(Operation.invokeHostFunction({
          func: xdr.HostFunction.hostFunctionTypeUploadContractWasm(authWasm),
          auth: [],
        })),
      admin,
      server,
    );
    assertEquals(installAuthResult.status, "SUCCESS");
    const authWasmHash = sdk.hash(authWasm);

    // --- Step 2: Deploy Channel Auth ---
    console.log("  Deploying Channel Auth...");
    const account2 = await server.getAccount(admin.publicKey());
    const salt1 = crypto.getRandomValues(new Uint8Array(32));
    const deployAuthResult = await buildSimulateSign(
      new TransactionBuilder(account2, { fee: "10000000", networkPassphrase: NETWORK_PASSPHRASE })
        .addOperation(Operation.invokeHostFunction({
          func: xdr.HostFunction.hostFunctionTypeCreateContractV2(
            new xdr.CreateContractArgsV2({
              contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
                new xdr.ContractIdPreimageFromAddress({
                  address: Address.fromString(admin.publicKey()).toScAddress(),
                  salt: Buffer.from(salt1),
                })
              ),
              executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.from(authWasmHash)),
              constructorArgs: [
                nativeToScVal(Address.fromString(admin.publicKey()), { type: "address" }),
              ],
            })
          ),
          auth: [],
        })),
      admin,
      server,
    );
    assertEquals(deployAuthResult.status, "SUCCESS");
    const channelAuthId = extractContractId(deployAuthResult);
    assertExists(channelAuthId, "Channel Auth contract ID");
    console.log(`  Channel Auth: ${channelAuthId}`);

    // --- Step 3: Install Privacy Channel WASM ---
    console.log("  Installing Privacy Channel WASM...");
    const account3 = await server.getAccount(admin.publicKey());
    const installChResult = await buildSimulateSign(
      new TransactionBuilder(account3, { fee: "10000000", networkPassphrase: NETWORK_PASSPHRASE })
        .addOperation(Operation.invokeHostFunction({
          func: xdr.HostFunction.hostFunctionTypeUploadContractWasm(channelWasm),
          auth: [],
        })),
      admin,
      server,
    );
    assertEquals(installChResult.status, "SUCCESS");
    const channelWasmHash = sdk.hash(channelWasm);

    // --- Step 4: Deploy Privacy Channel ---
    console.log("  Deploying Privacy Channel...");
    // Resolve native XLM SAC for local network
    const xlmSac = sdk.Asset.native().contractId(NETWORK_PASSPHRASE);

    const account4 = await server.getAccount(admin.publicKey());
    const salt2 = crypto.getRandomValues(new Uint8Array(32));
    const deployChResult = await buildSimulateSign(
      new TransactionBuilder(account4, { fee: "10000000", networkPassphrase: NETWORK_PASSPHRASE })
        .addOperation(Operation.invokeHostFunction({
          func: xdr.HostFunction.hostFunctionTypeCreateContractV2(
            new xdr.CreateContractArgsV2({
              contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
                new xdr.ContractIdPreimageFromAddress({
                  address: Address.fromString(admin.publicKey()).toScAddress(),
                  salt: Buffer.from(salt2),
                })
              ),
              executable: xdr.ContractExecutable.contractExecutableWasm(Buffer.from(channelWasmHash)),
              constructorArgs: [
                nativeToScVal(Address.fromString(admin.publicKey()), { type: "address" }),
                nativeToScVal(Address.fromString(channelAuthId!), { type: "address" }),
                nativeToScVal(Address.fromString(xlmSac), { type: "address" }),
              ],
            })
          ),
          auth: [],
        })),
      admin,
      server,
    );
    assertEquals(deployChResult.status, "SUCCESS");
    const privacyChannelId = extractContractId(deployChResult);
    assertExists(privacyChannelId, "Privacy Channel contract ID");
    console.log(`  Privacy Channel: ${privacyChannelId}`);

    // --- Step 5: Add provider ---
    console.log("  Adding provider...");
    const contract = new Contract(channelAuthId!);
    const account5 = await server.getAccount(admin.publicKey());
    const addResult = await buildSimulateSign(
      new TransactionBuilder(account5, { fee: "10000000", networkPassphrase: NETWORK_PASSPHRASE })
        .addOperation(contract.call(
          "add_provider",
          nativeToScVal(Address.fromString(provider.publicKey()), { type: "address" }),
        )),
      admin,
      server,
    );
    assertEquals(addResult.status, "SUCCESS");
    console.log(`  Provider added: ${provider.publicKey()}`);

    // --- Step 6: Verify provider is registered ---
    console.log("  Verifying provider...");
    const account6 = await server.getAccount(admin.publicKey());
    const checkResult = await buildSimulateSign(
      new TransactionBuilder(account6, { fee: "10000000", networkPassphrase: NETWORK_PASSPHRASE })
        .addOperation(contract.call(
          "is_provider",
          nativeToScVal(Address.fromString(provider.publicKey()), { type: "address" }),
        )),
      admin,
      server,
    );
    assertEquals(checkResult.status, "SUCCESS");

    // --- Step 7: Remove provider ---
    console.log("  Removing provider...");
    const account7 = await server.getAccount(admin.publicKey());
    const removeResult = await buildSimulateSign(
      new TransactionBuilder(account7, { fee: "10000000", networkPassphrase: NETWORK_PASSPHRASE })
        .addOperation(contract.call(
          "remove_provider",
          nativeToScVal(Address.fromString(provider.publicKey()), { type: "address" }),
        )),
      admin,
      server,
    );
    assertEquals(removeResult.status, "SUCCESS");
    console.log(`  Provider removed: ${provider.publicKey()}`);

    console.log("  Deploy flow complete");
  },
  sanitizeResources: false,
  sanitizeOps: false,
});
