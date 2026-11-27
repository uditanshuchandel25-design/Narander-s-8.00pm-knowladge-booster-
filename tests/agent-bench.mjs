/**
 * BM INTEL — 4-Agent Stress Test & Efficiency Benchmark Suite
 * Benchmarks & validates:
 *  Agent 1: Live Research & Pre-Filtered Feed Harvester (runtime, skipped HTTP fetches, feed health)
 *  Agent 2: Senior BM Signal Editor Agent (16-case precision/recall, compression, zero-fluff)
 *  Agent 3: Command Centre Department Router (10-prompt routing accuracy + p95 latency)
 *  Agent 4: Approvals & Audit Gate Agent (draft quality, length limits, audit cap)
 */

import assert from "node:assert/strict";
import { runIntelFetch } from "../scripts/fetch-intel.js";
import { evaluateSignal, extractEffectiveTag, compressExecutiveBullets } from "../scripts/executive-editor.js";

const BASE_URL = process.env.BM_TEST_URL || "http://localhost:8080";

function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

async function runAllAgentsTest() {
  console.log("====================================================================");
  console.log("  BM INTEL — 4-AGENT STRESS TEST & EFFICIENCY BENCHMARK");
  console.log("====================================================================\n");

  // --- AGENT 1: Live Research & Pre-Filtered Feed Harvester ---
  const t0 = performance.now();
  const edition = await runIntelFetch();
  const harvestMs = Math.round(performance.now() - t0);
  const online = edition.stats.feedsOnline;
  const totalFeeds = edition.stats.feedsTotal;
  const skippedHttp = edition.editorAgent?.skippedHttpFetches || 0;

  assert.ok(online >= 15, `Agent 1 failed: only ${online}/${totalFeeds} feeds online`);
  assert.ok(harvestMs < 25000, `Agent 1 too slow: ${harvestMs}ms`);
  assert.ok(edition.stats.totalItems >= 10, `Agent 1 returned too few signals: ${edition.stats.totalItems}`);

  let missingSummary = 0;
  let overlongBullet = 0;
  for (const sec of edition.sections) {
    for (const item of sec.items) {
      if (!item.keyPoints || item.keyPoints.length === 0) missingSummary++;
      for (const kp of item.keyPoints || []) {
        if (kp.length > 180) overlongBullet++;
      }
    }
  }
  assert.equal(missingSummary, 0, "Found signal without crisp bullet summary!");
  assert.equal(overlongBullet, 0, "Found bullet exceeding crisp 180-char ceiling!");

  console.log(`✅ AGENT 1 [Research Harvester]`);
  console.log(`   • Full 18-feed live sync + deep extraction : ${harvestMs} ms`);
  console.log(`   • Feeds online                             : ${online}/${totalFeeds}`);
  console.log(`   • Pre-fetch HTML calls saved (Noise Gate)  : ${skippedHttp} wasted page fetches skipped`);
  console.log(`   • Curated crisp signals / Suppressed noise : ${edition.stats.totalItems} kept / ${edition.stats.suppressedCount} cut (~${edition.stats.estimatedReadMinutes} min read)`);

  // --- AGENT 2: Senior BM Signal Editor (16-Case Precision/Recall Matrix) ---
  const editorMatrix = [
    { h: "HDFC Bank to stop SMS alerts for UPI payments up to ₹500 from January 1, 2027", s: "CNBC-TV18", expect: true },
    { h: "RBI Issues Amendment Directions on Suspected Money Mule Accounts", s: "RBI Press Releases", expect: true },
    { h: "Bank of India raises MCLR on overnight, one-month loans; effective December 1", s: "CNBC-TV18", expect: true },
    { h: "SBI to increase lending under MSME Dream to ₹50 crore by March 2027", s: "Business Standard", expect: true },
    { h: "IRDAI mandates 1-hour cashless claim approval across health insurers", s: "Economic Times", expect: true },
    { h: "ICICI Bank revises fixed deposit rates by 25 bps for senior citizens", s: "Livemint", expect: true },
    { h: "HSBC India expands NRI FCNR deposit rates following US Fed decision", s: "BusinessLine", expect: true },
    { h: "Indian Bank gets nod to raise ₹2,500 cr through AT1 bonds", s: "BusinessLine", expect: true },
    { h: "Can your ULIP survive a 30% market crash? A 10-year risk analysis", s: "Economic Times", expect: false },
    { h: "Direct vs regular mutual funds: SIPs through distributors stay invested longer", s: "Livemint", expect: false },
    { h: "₹1.5 crore retirement corpus: How much monthly pension can you withdraw?", s: "Livemint", expect: false },
    { h: "SCSS vs HDFC Senior Citizen FD: Which gives better returns on ₹10,00,000?", s: "CNBC-TV18", expect: false },
    { h: "RBI to conduct Overnight Variable Rate Repo (VRR) auction under LAF", s: "RBI Press Releases", expect: false },
    { h: "Nestlé India receives ₹36.36 lakh EPFO notice, including damages and penalty", s: "Livemint", expect: false },
    { h: "EPFO's Nidhi Aapke Nikat 2.0 camps: How to check your nearest venue", s: "Livemint", expect: false },
    { h: "Gold price forecast: Fed rate hike may limit recovery to ₹1.30 lakh", s: "Livemint", expect: false },
  ];

  let correct = 0;
  for (const tc of editorMatrix) {
    const v = evaluateSignal({ headline: tc.h, source: tc.s });
    assert.equal(v.isSignal, tc.expect, `Editor mismatch on: ${tc.h}`);
    correct++;
  }
  assert.equal(extractEffectiveTag("Revised rates effective December 1, 2026"), "w.e.f. Dec 1, 2026");
  assert.equal(
    compressExecutiveBullets([
      "This means scheduled commercial banks must comply with revised KYC rules by July 1, 2027.",
      "According to a report, ATM interchange and withdrawal fees are capped at ₹23 per transaction plus taxes.",
    ]).length,
    2
  );

  console.log(`\n✅ AGENT 2 [Senior BM Signal Editor]`);
  console.log(`   • Precision & Recall benchmark             : ${correct}/${editorMatrix.length} (100% accuracy)`);
  console.log(`   • Bullet compactness ceiling               : 100% <= 180 chars, 0 blank summaries`);

  // --- AGENT 3: Command Centre Department Router ---
  const prompts = [
    { q: "What changed in HDFC Bank today?", expectDept: /HDFC|Policies/i, expectDraft: false },
    { q: "Summarize RBI KYC and money mule directions", expectDept: /Compliance|RBI/i, expectDraft: false },
    { q: "Show Bank of India MCLR and Dec 4 MPC rate outlook", expectDept: /Pricing|Rates/i, expectDraft: false },
    { q: "Any IRDAI health insurance or term plan changes?", expectDept: /Insurance/i, expectDraft: false },
    { q: "What is happening with BOJ or global central banks?", expectDept: /Global|Rates/i, expectDraft: false },
    { q: "Draft a WhatsApp update for my team on HDFC UPI SMS rule", expectDept: /Huddle|Communications/i, expectDraft: true },
    { q: "Write a short morning huddle note on RBI ATM fee cap", expectDept: /Huddle|Communications/i, expectDraft: true },
    { q: "Tell me about SBI MSME Dream loan limit", expectDept: /Policies|HDFC/i, expectDraft: false },
    { q: "What are the latest card payment consolidated rules?", expectDept: /Compliance|RBI|Policies/i, expectDraft: false },
    { q: "", expectDept: /Executive|Desk/i, expectDraft: false },
  ];

  const askLatencies = [];
  for (const p of prompts) {
    const s = performance.now();
    const res = await fetch(`${BASE_URL}/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: p.q }),
    });
    const elapsed = performance.now() - s;
    askLatencies.push(elapsed);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.department, p.expectDept, `Unexpected dept "${body.department}" for "${p.q}"`);
    assert.equal(Boolean(body.suggestedDraft), p.expectDraft, `Draft flag mismatch for "${p.q}"`);
  }

  const cacheLatencies = [];
  for (let i = 0; i < 10; i++) {
    const s = performance.now();
    const r = await fetch(`${BASE_URL}/api/latest`);
    await r.json();
    cacheLatencies.push(performance.now() - s);
  }

  const avgAskMs = (askLatencies.reduce((a, b) => a + b, 0) / askLatencies.length).toFixed(1);
  const p95AskMs = percentile(askLatencies, 95).toFixed(1);
  const avgCacheMs = (cacheLatencies.reduce((a, b) => a + b, 0) / cacheLatencies.length).toFixed(1);

  assert.ok(Number(avgAskMs) < 50, `Command Centre too slow: ${avgAskMs}ms`);
  console.log(`\n✅ AGENT 3 [Command Centre Router]`);
  console.log(`   • Department routing & draft accuracy      : ${prompts.length}/${prompts.length} (100%)`);
  console.log(`   • /api/ask latency (avg / p95)             : ${avgAskMs} ms / ${p95AskMs} ms`);
  console.log(`   • Cached /api/latest latency (10-hit avg)  : ${avgCacheMs} ms`);

  // --- AGENT 4: Approvals & Audit Gate Agent ---
  assert.ok(edition.pendingDrafts.length >= 2, "Expected >=2 approval drafts");
  for (const d of edition.pendingDrafts) {
    assert.ok(!/undefined|null/i.test(d.body), `Corrupt placeholder in draft: ${d.id}`);
    assert.ok(d.body.length > 60 && d.body.length < 1800, `Draft length out of WhatsApp bounds: ${d.body.length}`);
  }
  const auditRes = await (await fetch(`${BASE_URL}/api/audit`)).json();
  assert.ok(auditRes.entries.length >= 1 && auditRes.entries.length <= 80, `Audit cap violated: ${auditRes.entries.length}`);

  console.log(`\n✅ AGENT 4 [Approvals & Audit Gate]`);
  console.log(`   • Auto-prepared WhatsApp drafts verified   : ${edition.pendingDrafts.length} clean drafts (0 corrupt tokens)`);
  console.log(`   • Audit log bounded rotation               : ${auditRes.entries.length}/80 entries`);

  console.log("\n====================================================================");
  console.log("  ALL 4 AGENTS PASSED EFFICIENCY & RELIABILITY BENCHMARKS!");
  console.log("====================================================================");
}

runAllAgentsTest().catch((err) => {
  console.error("\n❌ AGENT BENCHMARK FAILED:", err);
  process.exit(1);
});
