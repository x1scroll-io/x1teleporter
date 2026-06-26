import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";

/**
 * TELEPORTER — any-chain → any-chain stablecoin aggregator + X1 on-ramp
 *
 * This is a UI shell wired to the real Teleporter routing model:
 *   routeType: 'direct' | 'x1' | 'x1_reverse' | 'sol_x1'
 *
 * It is FRONT-END ONLY and safe to click through with no wallet:
 *   - "Demo mode" (default) simulates quotes + the bridge animation so you can
 *     test the whole flow visually without LiFi keys or a live Warp Bridge.
 *   - When you wire the real backend, replace the functions marked  // <<< WIRE
 *     with calls to your /api/lifi/* proxy and the Warp Bridge instruction.
 *
 * Nothing here signs or moves funds. The Warp Bridge program ID + discriminator
 * are still UNVERIFIED — do not point this at mainnet money until the $1 capture
 * test confirms them.
 */

// ─────────────────────────────────────────────────────────────────────────────
//  CONFIG  (mirrors server.js — the canonical-ish token table)
// ─────────────────────────────────────────────────────────────────────────────

// ── FLAGS (must be defined BEFORE CHAINS/TOKENS, which reference them) ──
// DEMO_MODE: simulate quotes with no backend. Flip false when proxy is live.
const DEMO_MODE = true;
// ENABLE_TRON: website-only Tron support, bolt-on later. Flip true when ready.
const ENABLE_TRON = false;

const CHAINS = {
  x1:    { id: "x1",    name: "X1",          lifiKey: null,  chainId: null,  walletType: "solana", color: "#5B9DFF", glyph: "X1" },
  eth:   { id: "eth",   name: "Ethereum",    lifiKey: "eth", chainId: 1,     walletType: "evm",    color: "#627EEA", glyph: "Ξ" },
  bsc:   { id: "bsc",   name: "BNB Chain",   lifiKey: "bsc", chainId: 56,    walletType: "evm",    color: "#F0B90B", glyph: "B" },
  sol:   { id: "sol",   name: "Solana",      lifiKey: "SOL", chainId: "SOL", walletType: "solana", color: "#9945FF", glyph: "◎" },
  arb:   { id: "arb",   name: "Arbitrum",    lifiKey: "arb", chainId: 42161, walletType: "evm",    color: "#28A0F0", glyph: "A" },
  bas:   { id: "bas",   name: "Base",        lifiKey: "bas", chainId: 8453,  walletType: "evm",    color: "#0052FF", glyph: "□" },
  opt:   { id: "opt",   name: "Optimism",    lifiKey: "opt", chainId: 10,    walletType: "evm",    color: "#FF0420", glyph: "O" },
  pol:   { id: "pol",   name: "Polygon",     lifiKey: "pol", chainId: 137,   walletType: "evm",    color: "#8247E5", glyph: "⬡" },
  avax:  { id: "avax",  name: "Avalanche",   lifiKey: "ava", chainId: 43114, walletType: "evm",    color: "#E84142", glyph: "▲" },
  sonic: { id: "sonic", name: "Sonic",       lifiKey: "son", chainId: 146,   walletType: "evm",    color: "#5BC8F5", glyph: "S" },
  // TRON — gated. walletType 'tron' needs a TronLink connector (window.tronLink)
  // and TVM sign path. LiFi routes Tron, so quotes work; signing is the add.
  ...(ENABLE_TRON ? {
    tron: { id: "tron", name: "Tron", lifiKey: "tron", chainId: "TRON", walletType: "tron", color: "#EF0027", glyph: "T" },
  } : {}),
};

const TOKENS = {
  eth:   { USDC: { decimals: 6, address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" }, USDT: { decimals: 6, address: "0xdAC17F958D2ee523a2206206994597C13D831ec7" }, DAI: { decimals: 18, address: "0x6B175474E89094C44Da98b954EedeAC495271d0F" } },
  bsc:   { USDC: { decimals: 18, address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" }, USDT: { decimals: 18, address: "0x55d398326f99059fF775485246999027B3197955" }, DAI: { decimals: 18, address: "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3" } },
  sol:   { USDC: { decimals: 6, address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" }, USDT: { decimals: 6, address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" } },
  arb:   { USDC: { decimals: 6, address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" }, USDT: { decimals: 6, address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9" }, DAI: { decimals: 18, address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1" } },
  bas:   { USDC: { decimals: 6, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }, DAI: { decimals: 18, address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb" } },
  opt:   { USDC: { decimals: 6, address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" }, USDT: { decimals: 6, address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58" }, DAI: { decimals: 18, address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1" } },
  pol:   { USDC: { decimals: 6, address: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" }, USDT: { decimals: 6, address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" }, DAI: { decimals: 18, address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063" } },
  avax:  { USDC: { decimals: 6, address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E" }, USDT: { decimals: 6, address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7" }, DAI: { decimals: 18, address: "0xd586E7F844cEa2F87f50152665BCbc2C279D8d70" } },
  sonic: { USDC: { decimals: 6, address: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894" }, USDT: { decimals: 6, address: "0xE5DA20F15420aD15DE0fa650600aFc998bbE3955" } },
  x1:    { USDC: { decimals: 6, address: "USDC.X" } }, // Warp Bridge handles X1 side
  // TRON tokens — USDT is the headline (huge volume). TRC-20 addresses.
  ...(ENABLE_TRON ? {
    tron: {
      USDT: { decimals: 6, address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" },
      USDC: { decimals: 6, address: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8" },
    },
  } : {}),
};


// ── PERSISTENCE ──
// Uses localStorage in a real deployment; falls back to an in-memory store in
// sandboxes/artifacts where storage is blocked. Same API either way.
const memStore = {};
const store = {
  get(key) {
    try {
      if (typeof localStorage !== "undefined") {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : null;
      }
    } catch { /* fall through */ }
    return memStore[key] ?? null;
  },
  set(key, val) {
    try {
      if (typeof localStorage !== "undefined") { localStorage.setItem(key, JSON.stringify(val)); return; }
    } catch { /* fall through */ }
    memStore[key] = val;
  },
  del(key) {
    try {
      if (typeof localStorage !== "undefined") { localStorage.removeItem(key); return; }
    } catch { /* fall through */ }
    delete memStore[key];
  },
};
const HISTORY_KEY = "teleporter.history";
const PENDING_KEY = "teleporter.pending";

const FEE = { flat: 1, pct: 0.01, threshold: 100 }; // legacy display model (unused once LiFi fee is live)

// ── LiFi integrator config ──
// IMPORTANT: INTEGRATOR must be your registered LiFi integrator string for fees
// to actually collect to your account. INTEGRATOR_FEE is a float: 0.01 = 1%.
// Fees are withdrawn later via /v1/integrators/{INTEGRATOR}/withdraw/{chainId}.
const INTEGRATOR = "x1-teleporter-labs"; // registered LiFi integrator string
const INTEGRATOR_FEE = 0.01;     // 1% — LiFi max is 10% (0.10)
// Proxy base — Vercel serves /api/* as serverless functions on the same origin.
const API_BASE = "";

// ── Warp Bridge (Solana ↔ X1) — VERIFIED from live mainnet tx ──
// Program 6JbPTuxVuoTgyQeXFb9MH8C8nUY8NBbLP1Lu4B13JfMD, instruction BridgeOut.
// The bridge charges a FLAT 1 USDC fee (hardcoded, not %), and rejects bridges
// under $10. We skim our 1% BEFORE the bridge, so the post-skim amount must
// still clear Warp's $10 floor. Hence a $25 minimum into X1 (after 1% = $24.75,
// safely above $10 even if the LiFi leg lands a little short).
const WARP_FLAT_FEE = 1;     // USDC, charged by the Warp bridge itself
const WARP_MIN = 10;         // Warp rejects bridges below this (USDC)
const X1_MIN = 25;           // our enforced minimum into X1 (UX + safety buffer)
// WARP_LIVE gates the REAL Solana→X1 Warp execution (warpBridge.js).
// false (default) = stage 2 stays in safe demo animation; the real bridge code
// is NOT fired. Flip to true ONLY after runStage2({allowLive:false}) simulates
// clean against mainnet and you've confirmed the PDAs + seq. See STAGE2_README.
const WARP_LIVE = false;
// SECOND gate: even with WARP_LIVE true, this must ALSO be true to actually
// broadcast. WARP_LIVE alone = build + simulate (no send). Both = real send.
const WARP_LIVE_SEND = false;
// Solana RPC for the Warp leg. Use your own RPC for reliability in production.
const SOLANA_RPC = "https://api.mainnet-beta.solana.com";
// Your SVM fee wallet — where the 1% skim lands. Set before going live.
const FEE_WALLET_SVM = "11111111111111111111111111111111"; // <<< replace

function calcFee(amountUsd) {
  const n = parseFloat(amountUsd);
  if (isNaN(n) || n <= 0) return 0;
  return n < FEE.threshold ? FEE.flat : n * FEE.pct;
}

// route type from a (from,to) pair — the core routing brain, mirrored
function determineRoute(from, to) {
  if (to === "x1") return from === "sol" ? "sol_x1" : "x1";
  if (from === "x1") return "x1_reverse";
  return "direct";
}

const ROUTE_LABEL = {
  direct:     "Direct bridge",
  x1:         "On-ramp to X1",
  x1_reverse: "Off-ramp from X1",
  sol_x1:     "Solana → X1",
};

function tokensFor(chain) {
  return Object.keys(TOKENS[chain] || {});
}

// ─────────────────────────────────────────────────────────────────────────────
//  ANIMATED BACKGROUND — lightweight canvas nebula (no Three.js dependency
//  so it runs anywhere; ~self-contained). Drifting particle field + glow.
// ─────────────────────────────────────────────────────────────────────────────

// Styles (defined before components that reference S)
const S = {
  root: { position: "relative", minHeight: "100vh", background: "#05070d", color: "#e8edf6", textShadow: "0 1px 6px rgba(0,0,0,0.7)",
    fontFamily: "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif", overflow: "hidden" },
  shell: { position: "relative", zIndex: 1, maxWidth: 620, margin: "0 auto", padding: "32px 20px 48px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 22 },
  brand: { display: "flex", alignItems: "center", gap: 12 },
  brandMark: { width: 38, height: 38, borderRadius: 11, display: "grid", placeItems: "center",
    background: "linear-gradient(135deg,#2775E8,#5B9DFF)", color: "#ffffff", fontWeight: 800, fontSize: 15 },
  brandName: { fontWeight: 800, letterSpacing: 3, fontSize: 16 },
  brandSub: { fontSize: 11, color: "#7d8aa0", letterSpacing: 0.3 },
  walletBar: { display: "flex", gap: 8 },
  walletPill: { display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 999,
    background: "rgba(13,18,28,0.7)", border: "1px solid #28303f", color: "#e8edf6", cursor: "pointer" },
  dot: { width: 8, height: 8, borderRadius: 999 },
  routeBadge: { display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600,
    color: "#9aa6bb", padding: "6px 12px", borderRadius: 999, background: "rgba(13,18,28,0.6)",
    border: "1px solid #1d2433", marginBottom: 14 },
  routeDot: { width: 7, height: 7, borderRadius: 999 },
  twoStage: { marginLeft: 6, fontSize: 10, color: "#2775E8", border: "1px solid #1a3a6b",
    background: "rgba(39,117,232,0.08)", padding: "2px 7px", borderRadius: 999 },
  card: { background: "transparent", border: "1px solid rgba(39,117,232,0.25)", borderRadius: 20, padding: 22, boxShadow: "0 24px 80px rgba(0,0,0,0.5)" },
  fieldLabel: { fontSize: 11, color: "#7d8aa0", marginBottom: 6, fontWeight: 600, letterSpacing: 0.3 },
  selectWrap: { position: "relative" },
  select: { width: "100%", appearance: "none", background: "transparent", color: "#e8edf6",
    border: "1px solid #232c3c", borderRadius: 12, padding: "12px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  amountInput: { width: "100%", boxSizing: "border-box", background: "transparent", color: "#e8edf6",
    border: "1px solid #232c3c", borderRadius: 12, padding: "12px 14px", fontSize: 18, fontWeight: 700, outline: "none" },
  swapBtn: { width: 42, height: 42, borderRadius: 12, background: "transparent", border: "1px solid #232c3c",
    color: "#2775E8", fontSize: 18, cursor: "pointer", marginBottom: 1 },
  vizWrap: { marginTop: 22, marginBottom: 4, padding: "8px 4px" },
  quoteBox: { marginTop: 10, background: "transparent", border: "1px solid #1a2130", borderRadius: 14, padding: "12px 14px" },
  maxBtn: { background: "rgba(39,117,232,0.1)", border: "1px solid #1a3a6b", color: "#2775E8",
    borderRadius: 6, padding: "1px 6px", fontSize: 10, fontWeight: 700, cursor: "pointer" },
  detailBox: { marginTop: 10, background: "transparent", border: "1px solid #1a2130", borderRadius: 14, padding: "12px 14px" },
  detailHead: { fontSize: 11, color: "#7d8aa0", marginBottom: 8, fontWeight: 600, letterSpacing: 0.3 },
  toolChip: { fontSize: 12, color: "#e8edf6", background: "transparent", border: "1px solid #1d2433",
    padding: "4px 9px", borderRadius: 8, fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 },
  statusBox: { marginTop: 10, display: "flex", alignItems: "center", gap: 10, background: "transparent",
    border: "1px solid #1a2130", borderRadius: 14, padding: "12px 14px" },
  statusDot: { width: 10, height: 10, borderRadius: 999, flexShrink: 0 },
  recoverBanner: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
    background: "rgba(39,117,232,0.06)", border: "1px solid #1a3a6b", borderRadius: 14, padding: "12px 14px", marginBottom: 14 },
  recoverBtn: { background: "linear-gradient(90deg,#2775E8,#1B5FCC)", color: "#05070d", border: "none",
    borderRadius: 9, padding: "8px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer" },
  recoverDismiss: { background: "transparent", color: "#7d8aa0", border: "1px solid #28303f",
    borderRadius: 9, padding: "8px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  historyPanel: { marginTop: 14, background: "transparent", border: "1px solid #1a2130",
    borderRadius: 20, padding: 18 },
  settingsPanel: { background: "transparent", border: "1px solid #1a2130",
    borderRadius: 20, padding: 18, marginBottom: 14 },
  slipBtn: { background: "transparent", border: "1px solid #232c3c", color: "#9aa6bb",
    borderRadius: 10, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" },
  slipBtnActive: { background: "rgba(39,117,232,0.1)", borderColor: "#2775E8", color: "#2775E8" },
  slipInput: { width: 70, background: "transparent", border: "1px solid #232c3c", color: "#e8edf6",
    borderRadius: 10, padding: "8px 10px", fontSize: 13, fontWeight: 700, outline: "none", textAlign: "center" },
  histRow: { display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "10px 0", borderTop: "1px solid #141a26" },
  histStatus: { fontSize: 11, fontWeight: 700, border: "1px solid", borderRadius: 999, padding: "3px 9px", flexShrink: 0 },
  stepStrip: { display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" },
  stepChip: { fontSize: 11, color: "#9aa6bb", background: "transparent", border: "1px solid #1d2433",
    padding: "4px 9px", borderRadius: 999, fontWeight: 600 },
  cta: { width: "100%", padding: "15px", borderRadius: 14, border: "1px solid transparent",
    background: "linear-gradient(90deg,#2775E8,#1B5FCC)", color: "#05070d", fontSize: 15, fontWeight: 800,
    cursor: "pointer", letterSpacing: 0.3 },
  helper: { marginTop: 12, fontSize: 12, lineHeight: 1.5, color: "#9aa6bb", background: "rgba(39,117,232,0.05)",
    border: "1px solid #1a3a6b", borderRadius: 12, padding: "10px 12px" },
  foot: { textAlign: "center", fontSize: 11, color: "#475065", marginTop: 18, lineHeight: 1.5 },
  toast: { position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", zIndex: 10,
    background: "rgba(13,18,28,0.95)", border: "1px solid #28303f", borderRadius: 12, padding: "12px 18px",
    fontSize: 13, fontWeight: 600, boxShadow: "0 12px 40px rgba(0,0,0,0.5)" },
};

function PortalBackground() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf, w, h, t = 0;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

    const stars = [];
    function spawnStar(cx, cy, maxR) {
      // start near center with a random angle; warp outward
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * maxR * 0.15 + 4; // begin close to core
      return {
        angle,
        dist,
        speed: Math.random() * 0.6 + 0.4, // base radial speed factor
        len: 0,
        bright: Math.random() * 0.5 + 0.5,
      };
    }
    function resize() {
      w = canvas.width = canvas.offsetWidth * devicePixelRatio;
      h = canvas.height = canvas.offsetHeight * devicePixelRatio;
      stars.length = 0;
      const cx = w * 0.5, cy = h * 0.42;
      const maxR = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
      const count = Math.min(507, Math.floor((w * h) / 7179));
      for (let i = 0; i < count; i++) {
        const s = spawnStar(cx, cy, maxR);
        s.dist = Math.random() * maxR; // scatter initial positions so it's full immediately
        stars.push(s);
      }
    }
    resize();
    window.addEventListener("resize", resize);

    // draw a ring of dashed/segmented arcs at a given radius, rotated by `rot`
    function ringSegments(cx, cy, radius, rot, segs, gap, lineW, color, alpha) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.lineWidth = lineW * devicePixelRatio;
      ctx.strokeStyle = color;
      ctx.globalAlpha = alpha;
      const step = (Math.PI * 2) / segs;
      for (let i = 0; i < segs; i++) {
        const a0 = i * step;
        const a1 = a0 + step * (1 - gap);
        ctx.beginPath();
        ctx.arc(0, 0, radius, a0, a1);
        ctx.stroke();
      }
      ctx.restore();
    }

    function draw() {
      t += reduced ? 0 : 0.0025;
      ctx.clearRect(0, 0, w, h);

      // deep radial backdrop
      const cx = w * 0.5, cy = h * 0.42;
      const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.7);
      bg.addColorStop(0, "rgba(10,18,34,0.9)");
      bg.addColorStop(1, "rgba(3,5,10,1)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // WARP-SPEED STARS — streak radially outward from the core, accelerating
      const maxR = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
      ctx.lineCap = "round";
      for (const s of stars) {
        const prevDist = s.dist;
        if (!reduced) {
          // acceleration: speed scales with distance (faster as it nears edge)
          s.dist += (s.speed * (1.2 + (s.dist / maxR) * 7)) * devicePixelRatio;
        }
        // respawn when it flies off the edge
        if (s.dist > maxR) {
          const ns = spawnStar(cx, cy, maxR);
          Object.assign(s, ns);
          continue;
        }
        const cos = Math.cos(s.angle), sin = Math.sin(s.angle);
        const x1 = cx + cos * prevDist, y1 = cy + sin * prevDist;
        const x2 = cx + cos * s.dist,   y2 = cy + sin * s.dist;
        // streak gets longer + brighter + thicker as it moves out
        const f = s.dist / maxR;
        const alpha = Math.min(1, 0.15 + f * 0.95) * s.bright;
        ctx.strokeStyle = `rgba(200,222,255,${alpha})`;
        ctx.lineWidth = (0.4 + f * 1.8) * devicePixelRatio;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // the portal: concentric glowing rings, counter-rotating HUD segments
      const base = Math.min(w, h) * 0.34;
      const teal = "rgba(39,117,232,1)";
      const tealDim = "rgba(39,117,232,1)";

      // inner glow disc
      const glow = ctx.createRadialGradient(cx, cy, base * 0.2, cx, cy, base * 1.15);
      glow.addColorStop(0, "rgba(39,117,232,0.06)");
      glow.addColorStop(0.7, "rgba(39,117,232,0.12)");
      glow.addColorStop(1, "rgba(39,117,232,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, base * 1.15, 0, Math.PI * 2);
      ctx.fill();

      // solid thin core ring
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.5 * devicePixelRatio;
      ctx.strokeStyle = teal;
      ctx.beginPath();
      ctx.arc(cx, cy, base * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // rotating segmented rings at several radii (HUD look)
      ringSegments(cx, cy, base * 0.78,  t * 1.0,  18, 0.45, 2.5, tealDim, 0.55);
      ringSegments(cx, cy, base * 0.90, -t * 0.7,  6,  0.25, 6,   tealDim, 0.30);
      ringSegments(cx, cy, base * 1.00,  t * 0.5,  40, 0.6,  1.5, tealDim, 0.40);
      ringSegments(cx, cy, base * 1.12, -t * 0.35, 12, 0.55, 3,   tealDim, 0.25);

      // a few bright "tick" blocks on the outer ring
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t * 0.5);
      ctx.fillStyle = teal;
      ctx.globalAlpha = 0.7;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const rr = base * 1.05;
        const bx = Math.cos(a) * rr, by = Math.sin(a) * rr;
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(a);
        ctx.fillRect(-1.5 * devicePixelRatio, -5 * devicePixelRatio, 3 * devicePixelRatio, 10 * devicePixelRatio);
        ctx.restore();
      }
      ctx.restore();

      raf = requestAnimationFrame(draw);
    }
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);
  return <canvas ref={ref} style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 0 }} />;
}

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTE VISUALIZER — the signature element. Draws the hop path and animates
//  a particle stream along it when a bridge is "in flight".
// ─────────────────────────────────────────────────────────────────────────────

function RouteVisualizer({ hops, active, progress }) {
  // hops: [{ name, color, glyph }]
  const n = hops.length;
  const pad = 48;
  const W = 560, H = 120;
  const xs = hops.map((_, i) => pad + (i * (W - pad * 2)) / Math.max(1, n - 1));
  const y = H / 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <defs>
        <linearGradient id="pathgrad" x1="0" y1="0" x2="1" y2="0">
          {hops.map((hp, i) => (
            <stop key={i} offset={`${(i / Math.max(1, n - 1)) * 100}%`} stopColor={hp.color} />
          ))}
        </linearGradient>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* base track */}
      <line x1={xs[0]} y1={y} x2={xs[n - 1]} y2={y} stroke="#1d2433" strokeWidth="3" strokeLinecap="round" />
      {/* gradient path */}
      <line x1={xs[0]} y1={y} x2={xs[n - 1]} y2={y} stroke="url(#pathgrad)" strokeWidth="3"
            strokeLinecap="round" opacity={active ? 0.9 : 0.55} />

      {/* moving particle when active */}
      {active && (
        <circle r="5" fill="#fff" filter="url(#glow)">
          <animate attributeName="cx" values={`${xs[0]};${xs[n - 1]}`} dur="1.6s" repeatCount="indefinite" />
          <animate attributeName="cy" values={`${y};${y}`} dur="1.6s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;1;1;0" dur="1.6s" repeatCount="indefinite" />
        </circle>
      )}

      {/* progress fill */}
      {active && progress > 0 && (
        <line x1={xs[0]} y1={y} x2={xs[0] + (xs[n - 1] - xs[0]) * progress} y2={y}
              stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity="0.85" />
      )}

      {/* nodes */}
      {hops.map((hp, i) => (
        <g key={i}>
          <circle cx={xs[i]} cy={y} r="22" fill="#0a0e16" stroke={hp.color} strokeWidth="2"
                  filter={active ? "url(#glow)" : undefined} />
          <text x={xs[i]} y={y + 6} textAnchor="middle" fontSize="18" fill={hp.color} fontWeight="700">{hp.glyph}</text>
          <text x={xs[i]} y={y + 44} textAnchor="middle" fontSize="11" fill="#7d8aa0" fontWeight="600">{hp.name}</text>
        </g>
      ))}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  SMALL UI PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────

function ChainSelect({ label, value, onChange, exclude }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={S.fieldLabel}>{label}</div>
      <div style={S.selectWrap}>
        <select value={value} onChange={(e) => onChange(e.target.value)} style={S.select}>
          {Object.values(CHAINS)
            .filter((c) => c.id !== exclude)
            .map((c) => <option key={c.id} value={c.id}>{c.glyph}  {c.name}</option>)}
        </select>
      </div>
    </div>
  );
}

function WalletPill({ role, type, connected, addr, onClick, busy }) {
  const label = type === "evm" ? "MetaMask" : type === "solana" ? "Phantom" : "Wallet";
  return (
    <button onClick={onClick} disabled={busy} style={{ ...S.walletPill, borderColor: connected ? "#2775E8" : "#28303f", opacity: busy ? 0.6 : 1 }}>
      <span style={{ ...S.dot, background: connected ? "#2775E8" : "#475065" }} />
      <span style={{ fontSize: 11, color: "#7d8aa0" }}>{role}</span>
      <span style={{ fontSize: 13, fontWeight: 600 }}>
        {busy ? "Connecting…" : connected ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : `Connect ${label}`}
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────────────────

export default function Teleporter() {
  const [from, setFrom] = useState("eth");
  const [to, setTo] = useState("x1");
  const [token, setToken] = useState("USDC");
  const [toToken, setToToken] = useState("USDC");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState(null);
  const [phase, setPhase] = useState("idle"); // idle|quoting|quoted|bridging|step2|done|failed
  const [progress, setProgress] = useState(0);
  const [toast, setToast] = useState(null);

  // demo wallets (front-end only)
  const [evmWallet, setEvmWallet] = useState(null);
  const [solWallet, setSolWallet] = useState(null);
  const [connecting, setConnecting] = useState(null); // 'evm' | 'solana' | null

  // ── new feature state ──
  const [balances, setBalances] = useState({});      // { 'eth:USDC': '123.45', ... }
  const [loadingBal, setLoadingBal] = useState(false);
  const [routeDetail, setRouteDetail] = useState(null); // bridges/tools LiFi picked
  const [trackStatus, setTrackStatus] = useState(null); // live LiFi status
  const [pending, setPending] = useState(() => store.get(PENDING_KEY));         // remembered-intent recovery
  const [history, setHistory] = useState(() => store.get(HISTORY_KEY) || []);   // past bridges
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [slippage, setSlippage] = useState(0.5); // percent
  const trackTimer = useRef(null);

  // persist history + pending whenever they change
  useEffect(() => { store.set(HISTORY_KEY, history); }, [history]);
  useEffect(() => { if (pending) store.set(PENDING_KEY, pending); else store.del(PENDING_KEY); }, [pending]);

  // ── REAL WALLET CONNECT ──
  // MetaMask (and any EIP-1193 wallet) via window.ethereum.
  // Phantom via window.solana. Falls back to a demo address if no wallet is
  // present, so the UI stays usable in the preview/sandbox.
  const connectEvm = useCallback(async () => {
    if (evmWallet) { setEvmWallet(null); return; }
    const eth = typeof window !== "undefined" ? window.ethereum : null;
    if (!eth) {
      flash("No EVM wallet found — using demo address", "info");
      setEvmWallet({ addr: "0x7F10b546496Bc6bb47825f0cB8185C3263C7C822", demo: true });
      return;
    }
    try {
      setConnecting("evm");
      const accts = await eth.request({ method: "eth_requestAccounts" });
      if (accts?.[0]) {
        setEvmWallet({ addr: accts[0], provider: eth });
        flash("EVM wallet connected", "success");
      }
    } catch (e) {
      flash(e?.code === 4001 ? "Connection rejected" : "EVM connect failed", "err");
    } finally { setConnecting(null); }
  }, [evmWallet]);

  const connectSol = useCallback(async () => {
    if (solWallet) { setSolWallet(null); return; }
    const sol = typeof window !== "undefined" ? (window.solana || window.phantom?.solana) : null;
    if (!sol) {
      flash("Phantom not found — using demo address", "info");
      setSolWallet({ addr: "EAj1z4q6RN17BswMK38fADDEJQ5JTqy2WoTdky3drX6X", demo: true });
      return;
    }
    try {
      setConnecting("solana");
      const res = await sol.connect();
      const addr = res?.publicKey?.toString?.() || sol.publicKey?.toString?.();
      if (addr) {
        setSolWallet({ addr, provider: sol });
        flash("Phantom connected", "success");
      }
    } catch (e) {
      flash(e?.code === 4001 ? "Connection rejected" : "Phantom connect failed", "err");
    } finally { setConnecting(null); }
  }, [solWallet]);

  // Reconnect on load if a wallet already authorized this site
  useEffect(() => {
    const eth = typeof window !== "undefined" ? window.ethereum : null;
    if (eth?.request) {
      eth.request({ method: "eth_accounts" }).then((a) => {
        if (a?.[0]) setEvmWallet({ addr: a[0], provider: eth });
      }).catch(() => {});
      // reflect account switches
      eth.on?.("accountsChanged", (a) => setEvmWallet(a?.[0] ? { addr: a[0], provider: eth } : null));
    }
    const sol = typeof window !== "undefined" ? (window.solana || window.phantom?.solana) : null;
    if (sol?.isPhantom) {
      sol.connect({ onlyIfTrusted: true })
        .then((r) => { const a = r?.publicKey?.toString?.(); if (a) setSolWallet({ addr: a, provider: sol }); })
        .catch(() => {});
    }
  }, []);

  const routeType = useMemo(() => determineRoute(from, to), [from, to]);

  // keep token valid when chain changes
  useEffect(() => {
    const t = tokensFor(from);
    if (!t.includes(token)) setToken(t[0]);
  }, [from]); // eslint-disable-line
  useEffect(() => {
    const t = tokensFor(to);
    if (!t.includes(toToken)) setToToken(t[0]);
  }, [to]); // eslint-disable-line

  const flash = (msg, kind = "info") => { setToast({ msg, kind }); setTimeout(() => setToast(null), 3200); };

  // hops for the visualizer based on route type
  const hops = useMemo(() => {
    const node = (id) => ({ name: CHAINS[id].name, color: CHAINS[id].color, glyph: CHAINS[id].glyph });
    switch (routeType) {
      case "direct":     return [node(from), node(to)];
      case "x1":         return [node(from), node("sol"), node("x1")];
      case "x1_reverse": return [node("x1"), node("sol"), node(to)];
      case "sol_x1":     return [node("sol"), node("x1")];
      default:           return [node(from), node(to)];
    }
  }, [routeType, from, to]);

  const addHistory = useCallback((entry) => {
    setHistory((h) => [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ts: Date.now(), ...entry }, ...h].slice(0, 50));
  }, []);
  const updateHistory = useCallback((id, patch) => {
    setHistory((h) => h.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  // ── REAL LiFi TRANSACTION EXECUTION ──
  // Takes the LiFi quote's transactionRequest and sends it via the EVM wallet.
  // Returns the tx hash on success. Solana-origin LiFi steps would use the
  // Phantom provider instead (sketched but EVM is the primary path).
  function getOriginWallet() {
    const c = CHAINS[from];
    if (c.walletType === "evm") return evmWallet ? { ...evmWallet, type: "evm" } : null;
    if (c.walletType === "solana") return solWallet ? { ...solWallet, type: "solana" } : null;
    return null;
  }

  const executeLiFiTx = useCallback(async (lifiData) => {
    let txReq = lifiData?.transactionRequest || lifiData?.steps?.[0]?.transactionRequest;
    if (!txReq) throw new Error("No transaction data in quote");

    const w = getOriginWallet();
    if (!w || w.type !== "evm" || !w.provider) throw new Error("Connect an EVM wallet to sign");

    // Send via EIP-1193 directly (no ethers dependency needed).
    const params = [{
      from: w.addr,
      to: txReq.to,
      data: txReq.data,
      value: txReq.value || "0x0",
      ...(txReq.gasLimit ? { gas: typeof txReq.gasLimit === "string" ? txReq.gasLimit : "0x" + BigInt(txReq.gasLimit).toString(16) } : {}),
    }];
    const txHash = await w.provider.request({ method: "eth_sendTransaction", params });
    return txHash;
  }, [evmWallet, solWallet]);

  // helper to resolve the origin wallet (used by executeLiFiTx + quote)
  const ERC20_BAL = "0x70a08231"; // balanceOf(address) selector

  const fetchBalance = useCallback(async (chainId, sym) => {
    const tk = TOKENS[chainId]?.[sym];
    if (!tk) return null;
    const c = CHAINS[chainId];

    if (DEMO_MODE) {
      // deterministic-ish fake balance so the UI feels alive
      const seed = (chainId + sym).split("").reduce((a, ch) => a + ch.charCodeAt(0), 0);
      return ((seed % 900) + 10 + (seed % 100) / 100).toFixed(2);
    }

    try {
      if (c.walletType === "evm" && evmWallet?.provider) {
        const data = ERC20_BAL + evmWallet.addr.slice(2).padStart(64, "0");
        const hex = await evmWallet.provider.request({
          method: "eth_call",
          params: [{ to: tk.address, data }, "latest"],
        });
        const raw = BigInt(hex || "0x0");
        return (Number(raw) / 10 ** tk.decimals).toFixed(2);
      }
      if (c.walletType === "solana" && solWallet?.addr) {
        // light JSON-RPC call to a public Solana RPC for SPL balance
        const rpc = "https://api.mainnet-beta.solana.com";
        const body = {
          jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner",
          params: [solWallet.addr, { mint: tk.address }, { encoding: "jsonParsed" }],
        };
        const r = await fetch(rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const j = await r.json();
        const acct = j?.result?.value?.[0]?.account?.data?.parsed?.info?.tokenAmount;
        return acct ? Number(acct.uiAmount).toFixed(2) : "0.00";
      }
    } catch { return null; }
    return null;
  }, [evmWallet, solWallet]);

  // refresh the balance for the currently-selected from-chain token
  useEffect(() => {
    const c = CHAINS[from];
    const haveWallet = (c.walletType === "evm" && evmWallet) || (c.walletType === "solana" && solWallet);
    if (!haveWallet && !DEMO_MODE) { setBalances((b) => ({ ...b, [`${from}:${token}`]: null })); return; }
    let cancelled = false;
    setLoadingBal(true);
    fetchBalance(from, token).then((bal) => {
      if (!cancelled) { setBalances((b) => ({ ...b, [`${from}:${token}`]: bal })); setLoadingBal(false); }
    });
    return () => { cancelled = true; };
  }, [from, token, evmWallet, solWallet, fetchBalance]);

  const currentBalance = balances[`${from}:${token}`];
  const setMax = () => { if (currentBalance && currentBalance !== "0.00") setAmount(currentBalance); };

  // ───────────────────────────────────────────────────────────────────────────
  //  FEATURE 2 — ROUTE DETAIL  (which bridges/DEXes LiFi actually chose)
  // ───────────────────────────────────────────────────────────────────────────
  // Parses LiFi quote.includedSteps into a readable tool path.
  const extractRouteDetail = useCallback((lifiData) => {
    if (!lifiData) return null;
    const steps = lifiData.includedSteps || lifiData.steps || [];
    const tools = [];
    for (const s of steps) {
      const name = s.toolDetails?.name || s.tool || s.type;
      const type = s.type === "swap" ? "swap" : s.type === "cross" ? "bridge" : s.type;
      if (name) tools.push({ name, type });
    }
    // est. time + gas if present
    const est = lifiData.estimate || {};
    const seconds = est.executionDuration;
    const gasUsd = (est.gasCosts || []).reduce((a, g) => a + parseFloat(g.amountUSD || 0), 0);
    return { tools, seconds, gasUsd };
  }, []);

  // DEMO route detail so the panel shows something realistic
  const demoRouteDetail = useCallback(() => {
    const pool = ["Across", "Stargate", "Mayan", "CCTP", "Allbridge"];
    const pick = pool[(from.length + to.length) % pool.length];
    const tools = [];
    if (routeType !== "sol_x1") tools.push({ name: pick, type: "bridge" });
    if (routeType === "x1" || routeType === "sol_x1") tools.push({ name: "Warp Bridge", type: "bridge" });
    if (routeType === "x1_reverse") tools.unshift({ name: "Warp Bridge", type: "bridge" });
    return { tools, seconds: 30 + ((from.length * 7) % 90), gasUsd: 0.4 + ((to.length % 5) / 10) };
  }, [from, to, routeType]);

  // ───────────────────────────────────────────────────────────────────────────
  //  FEATURE 3 — LIVE STATUS TRACKER  (poll LiFi /status after a real send)
  // ───────────────────────────────────────────────────────────────────────────
  const startStatusPoll = useCallback((txHash, fromKey, toKey, histId) => {
    clearInterval(trackTimer.current);
    setTrackStatus({ state: "PENDING", label: "Submitted — waiting for bridge…" });
    if (DEMO_MODE) {
      const seq = [
        { state: "PENDING", label: "Confirming on source chain…" },
        { state: "PENDING", label: "Bridging across…" },
        { state: "PENDING", label: "Arriving on destination…" },
        { state: "DONE", label: "Funds delivered" },
      ];
      let i = 0;
      trackTimer.current = setInterval(() => {
        setTrackStatus(seq[i]);
        if (seq[i].state === "DONE") {
          clearInterval(trackTimer.current); setPhase("done");
          if (histId) updateHistory(histId, { status: "done" });
        }
        i++;
      }, 1400);
      return;
    }
    trackTimer.current = setInterval(async () => {
      try {
        const qs = new URLSearchParams({ txHash, fromChain: fromKey, toChain: toKey });
        const r = await fetch(`${API_BASE}/api/lifi/status?${qs}`);
        const j = await r.json();
        const state = j.status || j.state;
        if (state === "DONE") {
          setTrackStatus({ state: "DONE", label: "Funds delivered" });
          clearInterval(trackTimer.current); setPhase("done");
          if (histId) updateHistory(histId, { status: "done" });
        } else if (state === "FAILED") {
          setTrackStatus({ state: "FAILED", label: "Bridge failed — funds safe at source" });
          clearInterval(trackTimer.current); setPhase("failed");
          if (histId) updateHistory(histId, { status: "failed" });
        } else {
          setTrackStatus({ state: "PENDING", label: j.substatusMessage || "Bridging…" });
        }
      } catch { /* keep polling */ }
    }, 5000);
  }, [updateHistory]);

  useEffect(() => () => clearInterval(trackTimer.current), []);

  // ───────────────────────────────────────────────────────────────────────────
  //  FEATURE 4 — REMEMBERED-INTENT RECOVERY  (finish an interrupted X1 hop)
  // ───────────────────────────────────────────────────────────────────────────
  // When a 2-stage X1 route reaches step2, we persist the intent in memory
  // (and would persist to disk/localStorage in prod — note: artifacts can't use
  // localStorage, so this uses in-memory state here; wire to storage in your app).
  // On load / wallet connect, if a pending intent exists, offer to finish it.

  const rememberIntent = useCallback((intent) => {
    setPending(intent);
    // In your real app: await window.storage?.set('pendingBridge', JSON.stringify(intent))
  }, []);

  const clearIntent = useCallback(() => {
    setPending(null);
    // In your real app: await window.storage?.delete('pendingBridge')
  }, []);

  const buildLifiQuery = useCallback(() => {
    const amt = parseFloat(amount);
    const evmAddr = evmWallet?.addr || "0xd8da6bf26964af9d7eed9e03e53415d37aa96045"; // vitalik.eth fallback for quotes
    const solAddr = solWallet?.addr || "EAj1z4q6RN17BswMK38fADDEJQ5JTqy2WoTdky3drX6X";

    let fromChain, toChain, fromTok, toTok, fromAddr, decimals;
    if (routeType === "direct") {
      fromChain = CHAINS[from].lifiKey; toChain = CHAINS[to].lifiKey;
      fromTok = TOKENS[from][token].address; toTok = TOKENS[to][toToken].address;
      fromAddr = CHAINS[from].walletType === "evm" ? evmAddr : solAddr;
      decimals = TOKENS[from][token].decimals;
    } else if (routeType === "x1") {
      // from -> Solana USDC
      fromChain = CHAINS[from].lifiKey; toChain = CHAINS.sol.lifiKey;
      fromTok = TOKENS[from][token].address; toTok = TOKENS.sol.USDC.address;
      fromAddr = CHAINS[from].walletType === "evm" ? evmAddr : solAddr;
      decimals = TOKENS[from][token].decimals;
    } else if (routeType === "x1_reverse") {
      // Solana USDC -> to
      fromChain = CHAINS.sol.lifiKey; toChain = CHAINS[to].lifiKey;
      fromTok = TOKENS.sol.USDC.address; toTok = TOKENS[to][toToken].address;
      fromAddr = solAddr;
      decimals = 6; // Solana USDC
    } else {
      return null; // sol_x1: no LiFi leg
    }

    const rawAmount = BigInt(Math.floor(amt * 10 ** decimals)).toString();
    const qs = new URLSearchParams({
      fromChain, toChain, fromToken: fromTok, toToken: toTok,
      fromAmount: rawAmount, fromAddress: fromAddr,
      slippage: String(slippage / 100),
      integrator: INTEGRATOR,
      fee: String(INTEGRATOR_FEE), // <-- the 1% dev fee, collected by LiFi to your account
    });
    return { qs, decimals };
  }, [amount, from, to, token, toToken, routeType, evmWallet, solWallet, slippage]);

  // ── QUOTE ──
  const getQuote = useCallback(async () => {
    if (!amount || parseFloat(amount) <= 0) return flash("Enter an amount", "err");
    if (from === to) return flash("Source and destination must differ", "err");

    const amt = parseFloat(amount);

    // Routes that END in a Warp hop into X1 (x1 on-ramp + pure sol_x1) must clear
    // the bridge's $10 floor AFTER our 1% skim. We enforce a $25 minimum.
    const endsInX1 = routeType === "x1" || routeType === "sol_x1";
    if (endsInX1 && amt < X1_MIN) {
      return flash(`Bridge $${X1_MIN}+ into X1 to get started`, "err");
    }

    setPhase("quoting");

    // sol_x1 — pure Warp bridge, no LiFi leg. Fee stack: our 1% skim (before the
    // bridge) + Warp's flat $1. We skim, then bridge the remainder.
    if (routeType === "sol_x1") {
      await new Promise((r) => setTimeout(r, 400));
      const ourFee = amt * INTEGRATOR_FEE;          // our 1%, skimmed first
      const afterSkim = amt - ourFee;               // amount that reaches Warp
      const net = Math.max(0, afterSkim - WARP_FLAT_FEE); // Warp takes flat $1
      setQuote({
        amount: amt, feeUsd: ourFee, bridgeFee: WARP_FLAT_FEE, net,
        recvToken: "USDC.x", recvChain: "X1",
        note: "Solana → X1 via Warp Bridge",
        steps: hops.map((h) => ({ name: h.name, tool: "Warp Bridge" })),
      });
      setPhase("quoted");
      return;
    }

    // DEMO MODE — simulate, no backend needed
    if (DEMO_MODE) {
      await new Promise((r) => setTimeout(r, 650));
      const feeUsd = amt * INTEGRATOR_FEE;
      // x1 on-ramp ends in a Warp hop, so it also eats Warp's flat $1.
      const bridgeFee = routeType === "x1" ? WARP_FLAT_FEE : 0;
      const net = Math.max(0, amt - feeUsd - bridgeFee);
      const recvToken = routeType === "x1" ? "USDC.x" : toToken;
      const recvChain = routeType === "x1" ? "X1" : CHAINS[to].name;
      setQuote({
        amount: amt, feeUsd, bridgeFee, net, recvToken, recvChain, demo: true,
        steps: hops.map((h, i) => ({
          name: h.name,
          tool: h.name === "X1" ? "Warp Bridge" : (routeType === "sol_x1" ? "Warp Bridge" : "LiFi"),
        })),
      });
      setPhase("quoted");
      return;
    }

    // LIVE MODE — real LiFi call through your proxy
    try {
      const built = buildLifiQuery();
      if (!built) { flash("No route", "err"); setPhase("idle"); return; }
      const resp = await fetch(`${API_BASE}/api/lifi/quote?${built.qs}`);
      const data = await resp.json();
      if (data.error || data.message) {
        flash(data.message || data.error, "err"); setPhase("idle"); return;
      }
      // LiFi already deducted the integrator fee; estimate.toAmount is the honest output.
      const outDecimals = routeType === "x1"
        ? TOKENS.sol.USDC.decimals
        : (routeType === "x1_reverse" ? TOKENS[to][toToken].decimals : TOKENS[to][toToken].decimals);
      const out = parseFloat(data.estimate.toAmount) / 10 ** outDecimals;
      // The fee LiFi took, surfaced for display (from feeCosts if present).
      const feeUsd = amt * INTEGRATOR_FEE;
      // x1 on-ramp ends in a Warp hop -> also subtract the flat $1 bridge fee.
      const bridgeFee = routeType === "x1" ? WARP_FLAT_FEE : 0;
      const recvToken = routeType === "x1" ? "USDC.x" : toToken;
      const recvChain = routeType === "x1" ? "X1" : CHAINS[to].name;

      setQuote({
        amount: amt, feeUsd, bridgeFee, net: Math.max(0, out - bridgeFee), recvToken, recvChain, lifiData: data,
        steps: hops.map((h) => ({
          name: h.name,
          tool: h.name === "X1" ? "Warp Bridge" : "LiFi",
        })),
      });
      setPhase("quoted");
    } catch (e) {
      flash("Quote request failed", "err"); setPhase("idle");
    }
  }, [amount, from, to, routeType, toToken, hops, buildLifiQuery]);

  // ── HISTORY helpers ──
  // In your real app, persist with window.storage.set('history', ...) so it
  // survives reloads. Artifacts can't use localStorage, so this is in-memory.
  const execute = useCallback(async () => {
    setRouteDetail(DEMO_MODE ? demoRouteDetail() : extractRouteDetail(quote?.lifiData));
    const twoStage = routeType === "x1" || routeType === "x1_reverse" || routeType === "sol_x1";

    // record a pending history entry up front
    const histId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setHistory((h) => [{
      id: histId, ts: Date.now(), from, to, token,
      recvToken: quote?.recvToken, recvChain: quote?.recvChain,
      amount: quote?.amount, routeType, status: "pending", txHash: null,
    }, ...h].slice(0, 50));

    if (!DEMO_MODE) {
      // LIVE: sign and send the real LiFi transaction
      try {
        setPhase("bridging"); setProgress(0.1);
        const txHash = await executeLiFiTx(quote.lifiData);
        updateHistory(histId, { txHash, status: twoStage ? "stage1_done" : "bridging" });
        if (twoStage) {
          rememberIntent({ routeType, from, to, token, toToken, amount: quote?.amount,
            recvToken: quote?.recvToken, recvChain: quote?.recvChain, stage: "awaiting_stage2",
            histId, ts: Date.now() });
          setPhase("step2");
          flash("Stage 1 sent. Approve Stage 2 to finish.", "info");
        } else {
          startStatusPoll(txHash, CHAINS[from].lifiKey, CHAINS[to].lifiKey, histId);
          flash("Bridge submitted — tracking…", "info");
        }
      } catch (e) {
        updateHistory(histId, { status: "failed" });
        setPhase("quoted");
        flash(e?.message?.includes("reject") || e?.code === 4001 ? "Transaction rejected" : (e.message || "Send failed"), "err");
      }
      return;
    }

    // DEMO: animated path
    setPhase("bridging"); setProgress(0);
    for (let p = 0; p <= 1.0001; p += 0.04) {
      setProgress(Math.min(1, p));
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 60));
    }
    if (twoStage) {
      rememberIntent({ routeType, from, to, token, toToken, amount: quote?.amount,
        recvToken: quote?.recvToken, recvChain: quote?.recvChain, stage: "awaiting_stage2", histId, ts: Date.now() });
      updateHistory(histId, { status: "stage1_done" });
      setPhase("step2");
      flash("Stage 1 landed. Approve Stage 2 to finish.", "info");
      return;
    }
    startStatusPoll("0xdemoStage1Hash", CHAINS[from].lifiKey, CHAINS[to].lifiKey, histId);
    flash("Bridge submitted — tracking…", "info");
  }, [routeType, from, to, token, toToken, quote, demoRouteDetail, extractRouteDetail, rememberIntent, startStatusPoll, executeLiFiTx, updateHistory]);

  const executeStage2 = useCallback(async () => {
    setPhase("bridging"); setProgress(0);

    // ── LIVE PATH (gated) — real Solana→X1 Warp bridge via warpBridge.js ──
    if (WARP_LIVE && !DEMO_MODE) {
      try {
        const sol = typeof window !== "undefined" ? (window.solana || window.phantom?.solana) : null;
        if (!sol?.publicKey) { flash("Connect Phantom to finish the X1 hop", "err"); setPhase("quoted"); return; }
        const { Connection, PublicKey } = await import("@solana/web3.js");
        const { runStage2 } = await import("./warpBridge.js");
        const connection = new Connection(SOLANA_RPC, "confirmed");
        const amountHuman = quote?.amount ?? pending?.amount;
        const res = await runStage2({
          connection,
          userPubkey: sol.publicKey,
          feeWalletSvm: new PublicKey(FEE_WALLET_SVM),
          amountHuman,
          allowLive: WARP_LIVE_SEND, // second gate: only truly sends if this is true too
        });
        if (!res.success) {
          flash(`Bridge sim failed: ${JSON.stringify(res.sim?.err || "unknown")}`, "err");
          setPhase("quoted");
          return;
        }
        clearIntent();
        if (pending?.histId) updateHistory(pending.histId, { status: "done" });
        setProgress(1); setPhase("done");
        flash(res.sent ? "Bridged to X1 ✓" : "Simulation passed ✓ (not sent)", "success");
        return;
      } catch (e) {
        flash(`Warp error: ${String(e.message || e)}`, "err");
        setPhase("quoted");
        return;
      }
    }

    // ── DEMO PATH (default, safe) — animated, no real bridge ──
    for (let p = 0; p <= 1.0001; p += 0.05) {
      setProgress(Math.min(1, p));
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 55));
    }
    clearIntent(); // hop completed — forget the pending intent
    if (pending?.histId) updateHistory(pending.histId, { status: "done" });
    setPhase("done");
    flash("Bridge complete — funds on destination", "success");
  }, [clearIntent, pending, updateHistory, quote]);

  // resume an interrupted hop from the recovery banner
  const resumePending = useCallback(() => {
    if (!pending) return;
    // restore the form to the pending route and jump to stage 2
    setFrom(pending.from); setTo(pending.to);
    setToken(pending.token); setToToken(pending.toToken);
    setAmount(String(pending.amount || ""));
    setQuote({
      amount: pending.amount, feeUsd: (pending.amount || 0) * INTEGRATOR_FEE,
      net: (pending.amount || 0) * (1 - INTEGRATOR_FEE),
      recvToken: pending.recvToken, recvChain: pending.recvChain,
      steps: [], resumed: true,
    });
    setPhase("step2");
    flash("Resuming your X1 hop — approve Stage 2", "info");
  }, [pending]);

  const reset = () => { setPhase("idle"); setQuote(null); setProgress(0); setTrackStatus(null); setRouteDetail(null); };

  // ───────────────────────────────────────────────────────────────────────────
  //  FEATURE 1 — TOKEN BALANCES  (read the connected wallet)
  // ───────────────────────────────────────────────────────────────────────────
  // EVM: eth_call balanceOf on the token contract. SVM: getTokenAccountsByOwner.
  // In DEMO_MODE we synthesize believable balances so the UI is testable.
  const active = phase === "bridging" || phase === "step2";

  return (
    <div style={S.root}>
      <style>{`@keyframes pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.8); } }`}</style>
      <PortalBackground />
      <div style={S.shell}>
        {/* header */}
        <header style={S.header}>
          <div style={S.brand}>
            <span style={S.brandMark}>X1</span>
            <div>
              <div style={S.brandName}>TELEPORTER</div>
              <div style={S.brandSub}>stablecoin routing · any chain → X1</div>
            </div>
          </div>
          <div style={S.walletBar}>
            <button onClick={() => setShowSettings((v) => !v)} style={{ ...S.walletPill, borderColor: "#28303f", padding: "8px 11px" }} title="Settings">
              <span style={{ fontSize: 15 }}>⚙</span>
            </button>
            {history.length > 0 && (
              <button onClick={() => setShowHistory((v) => !v)} style={{ ...S.walletPill, borderColor: "#28303f" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>History ({history.length})</span>
              </button>
            )}
            <WalletPill role="ORIGIN" type="evm" connected={!!evmWallet}
              addr={evmWallet?.addr || ""} busy={connecting === "evm"}
              onClick={connectEvm} />
            <WalletPill role="DEST" type="solana" connected={!!solWallet}
              addr={solWallet?.addr || ""} busy={connecting === "solana"}
              onClick={connectSol} />
          </div>
        </header>

        {/* route badge */}
        <div style={S.routeBadge}>
          <span style={{ ...S.routeDot, background: CHAINS[to]?.color || "#2775E8" }} />
          {ROUTE_LABEL[routeType]}
          {(routeType === "x1" || routeType === "x1_reverse") && (
            <span style={S.twoStage}>2 signatures</span>
          )}
        </div>

        {/* recovery banner — finish an interrupted X1 hop */}
        {pending && phase !== "step2" && phase !== "bridging" && (
          <div style={S.recoverBanner}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#2775E8" }}>Unfinished X1 hop</div>
              <div style={{ fontSize: 12, color: "#9aa6bb", marginTop: 2 }}>
                Your {pending.amount} {pending.token} reached Solana but didn't finish to {pending.recvChain}.
                Your funds are safe — resume any time.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button style={S.recoverBtn} onClick={resumePending}>Finish</button>
              <button style={S.recoverDismiss} onClick={clearIntent}>Dismiss</button>
            </div>
          </div>
        )}

        {/* settings panel */}
        {showSettings && (
          <div style={S.settingsPanel}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Settings</span>
              <button onClick={() => setShowSettings(false)} style={S.recoverDismiss}>Close</button>
            </div>

            <div style={S.fieldLabel}>Slippage tolerance</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              {[0.1, 0.5, 1.0].map((s) => (
                <button key={s} onClick={() => setSlippage(s)}
                  style={{ ...S.slipBtn, ...(slippage === s ? S.slipBtnActive : {}) }}>
                  {s}%
                </button>
              ))}
              <input value={slippage} onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 50) setSlippage(v); }}
                inputMode="decimal" style={S.slipInput} />
            </div>

            <div style={S.fieldLabel}>Bridge fee</div>
            <div style={{ fontSize: 13, color: "#9aa6bb", lineHeight: 1.5 }}>
              A {(INTEGRATOR_FEE * 100).toFixed(0)}% fee is included in every quote, collected by LiFi
              on routes through an EVM chain, and at mint on the Solana↔X1 hop.
              The quote's "you receive" already reflects it — no hidden charges.
            </div>
          </div>
        )}

        {/* card */}
        <div style={S.card}>
          {/* from / to selectors */}
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
            <ChainSelect label="From" value={from} onChange={setFrom} exclude={to} />
            <button style={S.swapBtn} onClick={() => { const f = from; setFrom(to); setTo(f); }}>⇄</button>
            <ChainSelect label="To" value={to} onChange={setTo} exclude={from} />
          </div>

          {/* token + amount */}
          <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
            <div style={{ width: 130 }}>
              <div style={S.fieldLabel}>Token</div>
              <div style={S.selectWrap}>
                <select value={token} onChange={(e) => setToken(e.target.value)} style={S.select}>
                  {tokensFor(from).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={S.fieldLabel}>Amount</div>
                <div style={{ fontSize: 11, color: "#7d8aa0", display: "flex", gap: 6, alignItems: "center" }}>
                  {loadingBal ? "…" : currentBalance != null ? (
                    <>
                      <span>Bal: {currentBalance}</span>
                      <button onClick={setMax} style={S.maxBtn}>MAX</button>
                    </>
                  ) : null}
                </div>
              </div>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal"
                placeholder="0.00" style={S.amountInput} />
              {(routeType === "x1" || routeType === "sol_x1") && (
                <div style={{ fontSize: 11, color: "#5B9DFF", marginTop: 6, paddingLeft: 2 }}>
                  Bridge ${X1_MIN}+ into X1 to get started
                </div>
              )}
            </div>
          </div>

          {/* destination token for reverse/direct */}
          {(routeType === "direct" || routeType === "x1_reverse") && (
            <div style={{ marginTop: 12 }}>
              <div style={S.fieldLabel}>Receive token</div>
              <div style={{ ...S.selectWrap, maxWidth: 160 }}>
                <select value={toToken} onChange={(e) => setToToken(e.target.value)} style={S.select}>
                  {tokensFor(to).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* visualizer */}
          <div style={S.vizWrap}>
            <RouteVisualizer hops={hops} active={active} progress={progress} />
          </div>

          {/* quote panel */}
          {quote && (
            <div style={S.quoteBox}>
              <Row k="You send" v={`${quote.amount} ${token} on ${CHAINS[from].name}`} />
              <Row k={quote.feeUsd > 0 ? "Teleporter fee (1%)" : "Fee"} v={`$${(quote.feeUsd || 0).toFixed(2)}`} dim />
              {quote.bridgeFee > 0 && (
                <Row k="X1 bridge fee" v={`$${quote.bridgeFee.toFixed(2)}`} dim />
              )}
              <Row k="You receive" v={`≈ ${quote.net.toFixed(2)} ${quote.recvToken} on ${quote.recvChain}`} hi />
              {quote.note && <div style={{ fontSize: 11, color: "#7d8aa0", marginTop: 4 }}>{quote.note}</div>}
              <div style={S.stepStrip}>
                {quote.steps.map((s, i) => (
                  <span key={i} style={S.stepChip}>
                    {s.tool}<span style={{ color: "#475065" }}> · {s.name}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* route detail — which bridges LiFi chose */}
          {routeDetail && (phase === "bridging" || phase === "step2" || phase === "done") && (
            <div style={S.detailBox}>
              <div style={S.detailHead}>Route</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {routeDetail.tools.map((t, i) => (
                  <React.Fragment key={i}>
                    <span style={S.toolChip}>
                      <span style={{ color: t.type === "bridge" ? "#2775E8" : "#9945FF" }}>●</span> {t.name}
                    </span>
                    {i < routeDetail.tools.length - 1 && <span style={{ color: "#475065" }}>→</span>}
                  </React.Fragment>
                ))}
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: "#7d8aa0" }}>
                {routeDetail.seconds != null && <span>~{routeDetail.seconds}s</span>}
                {routeDetail.gasUsd != null && <span>gas ≈ ${routeDetail.gasUsd.toFixed(2)}</span>}
              </div>
            </div>
          )}

          {/* live status tracker */}
          {trackStatus && (
            <div style={{ ...S.statusBox, borderColor: trackStatus.state === "DONE" ? "#1f6b3a" : trackStatus.state === "FAILED" ? "#6b1f1f" : "#1a2130" }}>
              <span style={{
                ...S.statusDot,
                background: trackStatus.state === "DONE" ? "#5ee08a" : trackStatus.state === "FAILED" ? "#E84142" : "#2775E8",
                animation: trackStatus.state === "PENDING" ? "pulse 1.2s infinite" : "none",
              }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{trackStatus.label}</span>
            </div>
          )}
          <div style={{ marginTop: 18 }}>
            {phase === "idle" || phase === "quoting" ? (
              <button style={S.cta} onClick={getQuote} disabled={phase === "quoting"}>
                {phase === "quoting" ? "Finding route…" : "Get quote"}
              </button>
            ) : phase === "quoted" ? (
              <button style={S.cta} onClick={execute}>
                {routeType === "x1" || routeType === "x1_reverse" ? "Bridge — Step 1 of 2" : "Bridge now"}
              </button>
            ) : phase === "bridging" ? (
              <button style={{ ...S.cta, opacity: 0.7 }} disabled>Bridging… {(progress * 100).toFixed(0)}%</button>
            ) : phase === "step2" ? (
              <button style={{ ...S.cta, background: "linear-gradient(90deg,#1B5FCC,#5B9DFF)" }} onClick={executeStage2}>
                Step 2 of 2 — sign with Phantom →
              </button>
            ) : phase === "done" ? (
              <button style={{ ...S.cta, background: "#16321f", color: "#5ee08a", borderColor: "#1f6b3a" }} onClick={reset}>
                ✓ Complete — bridge again
              </button>
            ) : null}
          </div>

          {/* step2 helper note */}
          {phase === "step2" && (
            <div style={S.helper}>
              Stage 1 confirmed — your USDC landed on Solana. Approve Stage 2 to mint
              USDC.x on X1. If you stop here, your funds rest safely as USDC on Solana
              and you can finish any time.
            </div>
          )}
        </div>

        {/* transaction history */}
        {showHistory && history.length > 0 && (
          <div style={S.historyPanel}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Bridge history</span>
              <button onClick={() => setHistory([])} style={S.recoverDismiss}>Clear</button>
            </div>
            {history.map((h) => (
              <div key={h.id} style={S.histRow}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {h.amount} {h.token} · {CHAINS[h.from]?.name} → {h.recvChain || CHAINS[h.to]?.name}
                  </span>
                  <span style={{ fontSize: 11, color: "#7d8aa0" }}>
                    {new Date(h.ts).toLocaleString()} · {ROUTE_LABEL[h.routeType] || h.routeType}
                  </span>
                </div>
                <span style={{
                  ...S.histStatus,
                  color: h.status === "done" ? "#5ee08a" : h.status === "failed" ? "#E84142" : "#2775E8",
                  borderColor: h.status === "done" ? "#1f6b3a" : h.status === "failed" ? "#6b1f1f" : "#1a3a6b",
                }}>
                  {h.status === "done" ? "✓ done" : h.status === "failed" ? "✕ failed"
                    : h.status === "stage1_done" ? "● stage 2" : "● pending"}
                </span>
              </div>
            ))}
          </div>
        )}

        <div style={S.foot}>
          Demo mode · no funds move · Warp Bridge constants unverified — run the $1 capture test before going live
        </div>
      </div>

      {toast && (
        <div style={{ ...S.toast, borderColor: toast.kind === "err" ? "#E84142" : toast.kind === "success" ? "#1f6b3a" : "#28303f" }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function Row({ k, v, dim, hi }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
      <span style={{ color: "#7d8aa0", fontSize: 13 }}>{k}</span>
      <span style={{ color: hi ? "#2775E8" : dim ? "#9aa6bb" : "#e8edf6", fontSize: 13, fontWeight: hi ? 700 : 600 }}>{v}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  STYLES
// ─────────────────────────────────────────────────────────────────────────────

