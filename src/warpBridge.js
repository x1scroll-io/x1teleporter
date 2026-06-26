// warpBridge.js — Stage 2 of the X1 on-ramp: Solana USDC -> X1 USDC.x via Warp.
//
// This is the ONE leg LiFi can't do (X1 isn't on LiFi). It is built entirely
// from the VERIFIED spec decoded from a live mainnet BridgeOut tx
// (Dnac9WnDgXDz...). See WARP_BRIDGE_SPEC.md.
//
// ── WHAT THIS DOES ──
//   1. Skims your 1% fee (a plain SPL transfer to YOUR fee wallet).
//   2. Calls the Warp `BridgeOut` instruction with the remaining 99%.
//   3. USDC.x lands on X1 at the SAME address as the Solana sender.
//
// ── SAFETY (READ THIS) ──
//   * This touches REAL FUNDS on mainnet. ALWAYS run simulate() first.
//   * Three things MUST be verified against mainnet before trusting it live
//     (all marked `VERIFY:` below):
//       (a) the PDA derivations match the on-chain accounts in the spec,
//       (b) how the `seq` (sequence/nonce) is obtained,
//       (c) the exact account order + signer/writable flags.
//   * Until simulate() returns success with the expected balance changes,
//     DO NOT enable live execution.
//
// Requires: @solana/web3.js and @solana/spl-token in your app.
//   npm i @solana/web3.js @solana/spl-token

import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
  Connection,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

// ── VERIFIED CONSTANTS (from the decoded mainnet tx) ──
export const WARP_PROGRAM_ID = new PublicKey(
  "6JbPTuxVuoTgyQeXFb9MH8C8nUY8NBbLP1Lu4B13JfMD"
);
export const USDC_MINT = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
);
// BridgeOut instruction discriminator — VERIFIED, matches Teleporter V2.
export const BRIDGE_OUT_DISCRIMINATOR = Uint8Array.from([
  27, 194, 57, 119, 215, 165, 247, 150,
]);

// Accounts observed in the live tx. VERIFY: confirm each is either a fixed
// program account or correctly derived as a PDA before mainnet use.
export const WARP_ACCOUNTS = {
  // index 0 — config/state PDA (VERIFY derivation: seed "config")
  config: new PublicKey("48Po6qAHRJojbXH7KRqt6s5GfNfs9VEGccfqYEHmubEi"),
  // index 1 — token registry / mint config PDA (VERIFY: seed "token_registry" + mint)
  tokenRegistry: new PublicKey("34E131ZpUomghxgvW8RnYSucQrY2zNQZRyHgPzL4MqCf"),
  // index 2 — event_out PDA (VERIFY: seed "event_out"; holds the seq)
  eventOut: new PublicKey("DkaB5NKu1LwTJowrsBCgoYExi1iAKbV3Vv1Mi7Mju2Wd"),
  // index 6 — vault ATA (receives the locked USDC)
  vault: new PublicKey("C6byAvMfEa9wrbfVDeLEWbCkQNa8HAtpGxDPZKG3FqRp"),
  // index 7 — vault authority / vault state (VERIFY: seed "vault")
  vaultAuthority: new PublicKey("H3E5ywpQ96z5MfhKniB7n95sDq3asXeo46mQeLmiBZ26"),
  // index 8 — fee config / fee authority (VERIFY)
  feeConfig: new PublicKey("7bz2ZNphReLcmwv1tbhG8VnR1RzAzyxPNuKa3s2Jig7j"),
  // index 9 — fee collector side (VERIFY: the fee TOKEN account was
  //           687zDcYjQ15bLw3vVneVNUh8BryG7sw9Z2iLidPaG2uA in the transfer logs)
  feeCollector: new PublicKey("6ob9XW6f6mweGu5sGh3JwW2Vp6UNQApjuPvrubXMQXyi"),
};

// USDC has 6 decimals. 1 USDC = 1_000_000 base units.
const USDC_DECIMALS = 6;
export const ONE_USDC = 1_000_000n;

// Your fee model. SKIM is taken BEFORE the bridge (you can't touch Warp's
// hardcoded flat $1). VERIFY: set this to YOUR svm fee wallet.
export const SKIM_BPS = 100n; // 1.00% = 100 basis points

// ── helpers ──
export function toBaseUnits(humanUsdc) {
  // careful float->int: round to 6 dp
  return BigInt(Math.round(Number(humanUsdc) * 10 ** USDC_DECIMALS));
}
export function fromBaseUnits(base) {
  return Number(base) / 10 ** USDC_DECIMALS;
}

// Encode the BridgeOut instruction data: [disc(8)][seq:u64 LE][amount:u64 LE]
function encodeBridgeOutData(seq, amountGross) {
  const buf = new Uint8Array(8 + 8 + 8);
  buf.set(BRIDGE_OUT_DISCRIMINATOR, 0);
  const dv = new DataView(buf.buffer);
  dv.setBigUint64(8, BigInt(seq), true); // little-endian
  dv.setBigUint64(16, BigInt(amountGross), true);
  return buf;
}

// VERIFY: how seq is obtained. In the test tx seq=72058022987855936. It is a
// per-bridge nonce that lives in the event_out PDA. You MUST read the current
// value (or let the program auto-increment) — never hardcode. This reads the
// account and returns a best-effort seq; CONFIRM the byte offset by simulating.
export async function fetchSeq(connection) {
  const info = await connection.getAccountInfo(WARP_ACCOUNTS.eventOut);
  if (!info) throw new Error("event_out account not found");
  // VERIFY: the seq's offset inside the account data. Placeholder reads first u64.
  // Inspect the account layout on-chain to confirm the real offset before live use.
  const dv = new DataView(info.data.buffer, info.data.byteOffset, info.data.byteLength);
  // returning the raw first u64 as a candidate — DO NOT trust until simulated.
  return dv.getBigUint64(0, true);
}

// Build the full stage-2 transaction: [compute budget] + [1% skim] + [BridgeOut].
//
// params:
//   connection   : a @solana/web3.js Connection to a Solana RPC
//   userPubkey   : PublicKey of the connected Phantom wallet (sender = X1 dest)
//   feeWalletSvm : PublicKey of YOUR svm fee wallet (where the 1% lands)
//   amountHuman  : the user's USDC amount as a number (e.g. 25)
//   seq          : optional precomputed seq; if omitted, fetchSeq() is used
//
// returns: { transaction, skimBase, bridgeBase, seq } ready to simulate/sign.
export async function buildStage2({
  connection,
  userPubkey,
  feeWalletSvm,
  amountHuman,
  seq,
}) {
  if (!(userPubkey instanceof PublicKey)) userPubkey = new PublicKey(userPubkey);
  if (!(feeWalletSvm instanceof PublicKey)) feeWalletSvm = new PublicKey(feeWalletSvm);

  const grossAll = toBaseUnits(amountHuman); // total the user is sending
  const skimBase = (grossAll * SKIM_BPS) / 10_000n; // our 1%
  const bridgeBase = grossAll - skimBase; // the 99% that goes to Warp

  // Guard: after our skim, the amount must clear Warp's $10 floor.
  if (bridgeBase < 10n * ONE_USDC) {
    throw new Error(
      `After 1% skim, ${fromBaseUnits(bridgeBase)} USDC is below Warp's $10 minimum. ` +
        `Enforce the $25 app minimum upstream.`
    );
  }

  // Token accounts
  const userUsdcAta = await getAssociatedTokenAddress(USDC_MINT, userPubkey);
  const feeUsdcAta = await getAssociatedTokenAddress(USDC_MINT, feeWalletSvm);

  const tx = new Transaction();

  // 1) compute budget (observed ~30k; set 60k headroom)
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 60_000 }));

  // 2) OUR 1% skim — plain SPL transfer user -> your fee ATA.
  //    NOTE: the fee ATA must already exist, or add a create-ATA ix first.
  tx.add(
    createTransferInstruction(
      userUsdcAta, // source
      feeUsdcAta, // destination (your fee wallet's USDC ATA)
      userPubkey, // owner/authority (the user signs)
      skimBase, // amount = 1%
      [],
      TOKEN_PROGRAM_ID
    )
  );

  // 3) The Warp BridgeOut for the remaining 99%.
  const theSeq = seq ?? (await fetchSeq(connection));
  const data = encodeBridgeOutData(theSeq, bridgeBase);

  // Account order EXACTLY as decoded from the live tx (12 accounts).
  // VERIFY each flag against the spec before mainnet.
  const keys = [
    { pubkey: WARP_ACCOUNTS.config, isSigner: false, isWritable: true }, // 0
    { pubkey: WARP_ACCOUNTS.tokenRegistry, isSigner: false, isWritable: true }, // 1
    { pubkey: WARP_ACCOUNTS.eventOut, isSigner: false, isWritable: true }, // 2
    { pubkey: userPubkey, isSigner: true, isWritable: true }, // 3 (user/payer)
    { pubkey: userUsdcAta, isSigner: false, isWritable: true }, // 4 (user USDC ATA)
    { pubkey: USDC_MINT, isSigner: false, isWritable: true }, // 5
    { pubkey: WARP_ACCOUNTS.vault, isSigner: false, isWritable: true }, // 6
    { pubkey: WARP_ACCOUNTS.vaultAuthority, isSigner: false, isWritable: true }, // 7
    { pubkey: WARP_ACCOUNTS.feeConfig, isSigner: false, isWritable: true }, // 8
    { pubkey: WARP_ACCOUNTS.feeCollector, isSigner: false, isWritable: true }, // 9
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }, // 10
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // 11
  ];

  tx.add(
    new TransactionInstruction({
      programId: WARP_PROGRAM_ID,
      keys,
      data: Buffer.from(data),
    })
  );

  tx.feePayer = userPubkey;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;

  return { transaction: tx, skimBase, bridgeBase, seq: theSeq };
}

// ── SIMULATE FIRST — always call this before signing for real ──
// Returns the simulation result. If err is null and logs show BridgeOut +
// "Bridge out initiated", you're good. Inspect balance changes to confirm
// the 1% skim and the 99% lock happened as expected.
export async function simulateStage2(connection, transaction) {
  const sim = await connection.simulateTransaction(transaction);
  return {
    ok: sim.value.err === null,
    err: sim.value.err,
    logs: sim.value.logs,
    unitsConsumed: sim.value.unitsConsumed,
  };
}

// ── Sign + send via Phantom (window.solana) ──
// ONLY call after simulateStage2 returns ok:true and you've verified the logs.
export async function sendStage2ViaPhantom(connection, transaction) {
  const provider =
    typeof window !== "undefined" ? window.solana || window.phantom?.solana : null;
  if (!provider) throw new Error("No Solana wallet (Phantom) found");
  const signed = await provider.signTransaction(transaction);
  const sig = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

// ── Convenience: full guarded flow ──
// Builds, SIMULATES, and only sends if simulation passes AND allowLive is true.
export async function runStage2({
  connection,
  userPubkey,
  feeWalletSvm,
  amountHuman,
  allowLive = false, // must be explicitly set true to touch real funds
}) {
  const built = await buildStage2({
    connection,
    userPubkey,
    feeWalletSvm,
    amountHuman,
  });
  const sim = await simulateStage2(connection, built.transaction);
  if (!sim.ok) {
    return { stage: "simulation", success: false, sim, built };
  }
  if (!allowLive) {
    // dry run only — returns the passing simulation, sends nothing
    return { stage: "simulated_ok", success: true, sim, built, sent: null };
  }
  const sig = await sendStage2ViaPhantom(connection, built.transaction);
  return { stage: "sent", success: true, sim, built, signature: sig };
}
