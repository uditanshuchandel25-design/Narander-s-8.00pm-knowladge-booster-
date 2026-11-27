import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractEffectiveTag,
  evaluateSignal,
  compressExecutiveBullets,
  refineBmAction,
  runSeniorBmEditorAgent,
} from "../scripts/executive-editor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE_URL = process.env.BM_TEST_URL || "http://localhost:8080";

describe("1. Senior BM Signal Editor Agent (Unit Tests)", () => {
  test("suppresses beginner explainers, calculators, routine RBI VRR, and non-bank corporate notices", () => {
    const noiseCases = [
      { headline: "Can your ULIP survive a 30% market crash? A 10-year risk and taxation analysis", source: "Economic Times" },
      { headline: "Direct vs regular mutual funds: SIPs through distributors stay invested longer", source: "Livemint" },
      { headline: "₹1.5 crore retirement corpus: How much monthly pension can you withdraw?", source: "Livemint" },
      { headline: "SCSS vs HDFC Senior Citizen FD: Which gives better returns on ₹10,00,000?", source: "CNBC-TV18" },
      { headline: "RBI to conduct Overnight Variable Rate Repo (VRR) auction under LAF", source: "RBI Press Releases" },
      { headline: "Nestlé India receives ₹36.36 lakh EPFO notice, including damages and penalty", source: "Livemint" },
      { headline: "EPFO's Nidhi Aapke Nikat 2.0 camps: How to check your nearest venue", source: "Livemint" },
    ];
    for (const item of noiseCases) {
      const verdict = evaluateSignal(item);
      assert.equal(verdict.isSignal, false, `Expected noise to be suppressed: ${item.headline}`);
    }
  });

  test("keeps genuine net-new banking, RBI, rate, and HDFC policy signals", () => {
    const signalCases = [
      { headline: "HDFC Bank to stop SMS alerts for UPI payments up to ₹500 from January 1, 2027", source: "CNBC-TV18" },
      { headline: "RBI Issues Amendment Directions on ‘Suspected Money Mule Accounts to Prevent Cyber-enabled Financial Frauds’", source: "RBI Press Releases" },
      { headline: "Bank of India raises MCLR on overnight, one-month loans; revised rates effective December 1", source: "CNBC-TV18" },
      { headline: "SBI to increase lending under 'MSME Dream' to ₹50 crore by March 2027", source: "Business Standard" },
      { headline: "Indian Bank gets nod to raise ₹2,500 cr through AT1 bonds", source: "BusinessLine" },
    ];
    for (const item of signalCases) {
      const verdict = evaluateSignal(item);
      assert.equal(verdict.isSignal, true, `Expected real signal to be kept: ${item.headline}`);
    }
  });

  test("extracts crisp effective date chips accurately", () => {
    assert.equal(extractEffectiveTag("HDFC Bank to stop SMS alerts from January 1, 2027"), "w.e.f. Jan 1, 2027");
    assert.equal(extractEffectiveTag("The directions came into effect immediately on issuance."), "Effective Immediately");
    assert.equal(extractEffectiveTag("Revised MCLR effective December 1, 2026"), "w.e.f. Dec 1, 2026");
    assert.equal(extractEffectiveTag("Loan limit raised to Rs 50 crore by March 2027"), "Target Mar 2027");
  });

  test("compresses bullets by removing filler phrases and capping to max 2 crisp lines", () => {
    const out = compressExecutiveBullets(
      [
        "This means customers making UPI payments of ₹100, ₹200 or ₹500 will not receive an SMS alert.",
        "Feedback received on the above draft Directions has been examined and the consequent modifications have been suitably incorporated in the final Amendment Directions.",
        "According to a report, payments exceeding ₹500 will continue receiving SMS alerts.",
        "Extra fourth sentence that should be omitted.",
      ],
      "HDFC Bank to stop SMS alerts for UPI payments up to ₹500"
    );
    assert.equal(out.length, 2);
    assert.ok(!/^This means/i.test(out[0]));
    assert.ok(!/^According to/i.test(out[1]));
  });

  test("deduplicates media recap when official RBI circular already captures exact fact", () => {
    const { refinedSections, suppressedItems } = runSeniorBmEditorAgent([
      {
        id: "rbi_regulatory",
        shortTitle: "RBI & Regulatory",
        items: [
          {
            headline: "Reserve Bank of India (Digital Payments – Card-based transaction) Directions, 2026",
            source: "RBI Notifications",
            keyPoints: ["RBI has consolidated 25 existing circulars on debit, credit and prepaid card transactions into a single framework."],
            bankCategories: ["PSU/Govt"],
          },
        ],
      },
      {
        id: "bank_policies",
        shortTitle: "Bank Policies",
        items: [
          {
            headline: "RBI consolidates 25 card payment circulars into one framework",
            source: "Livemint",
            keyPoints: ["RBI has consolidated 25 existing circulars on debit, credit and prepaid card transactions into a single framework."],
            bankCategories: ["PSU/Govt"],
          },
        ],
      },
    ]);
    assert.equal(refinedSections[0].items.length, 1);
    assert.equal(refinedSections[1].items.length, 0);
    assert.equal(suppressedItems.length, 1);
    assert.match(suppressedItems[0].suppressedReason, /Merged into Official RBI/i);
  });

  test("generates tailored HDFC Panchkula BM Action lines", () => {
    const action = refineBmAction({
      headline: "HDFC Bank to stop SMS alerts for UPI payments up to ₹500 from January 1, 2027",
      keyPoints: [],
      bankCategories: ["HDFC"],
    });
    assert.match(action, /Jan 1, 2027/i);
    assert.match(action, /PBs\/Tellers/i);
  });
});

describe("2. Project Structure & PWA Asset Integrity", () => {
  const requiredFiles = [
    "server.js",
    "package.json",
    "scripts/sources.js",
    "scripts/fetch-intel.js",
    "scripts/executive-editor.js",
    "public/index.html",
    "public/styles.css",
    "public/app.js",
    "public/sw.js",
    "public/manifest.webmanifest",
    "public/icons/icon.svg",
    "start-app.bat",
    "install-8pm-agent.bat",
    ".github/workflows/daily-8pm-intel.yml",
  ];

  test("all core application, agent, PWA, and deployment files exist", () => {
    for (const rel of requiredFiles) {
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `Missing file: ${rel}`);
    }
    assert.equal(fs.existsSync(path.join(ROOT, "public/voice-agent.js")), false, "voice-agent.js should be removed");
    assert.equal(fs.existsSync(path.join(ROOT, "public/orb-avatar.js")), false, "orb-avatar.js should be removed");
  });
});

describe("3. Live Server & REST API Integration Tests", () => {
  test("serves all static PWA assets with HTTP 200 and no-store cache headers", async () => {
    const assets = ["/", "/styles.css", "/app.js", "/manifest.webmanifest", "/sw.js", "/icons/icon.svg"];
    for (const ep of assets) {
      const res = await fetch(BASE_URL + ep);
      assert.equal(res.status, 200, `Expected 200 for ${ep}`);
      assert.match(res.headers.get("cache-control") || "", /no-store/i, `Expected no-store on ${ep}`);
      const text = await res.text();
      assert.ok(text.length > 100, `Empty body on ${ep}`);
      if (ep === "/") {
        for (const id of ["attentionRows", "commandForm", "approvalsList", "auditLogList"]) {
          assert.ok(text.includes(`id="${id}"`), `Missing DOM element #${id} in index.html`);
        }
        assert.equal(text.includes("agentOrbCanvas"), false, "Voice orb markup should be removed");
        assert.equal(text.includes("askWhatToReadBtn"), false, "Voice button markup should be removed");
      }
    }
  });

  test("GET /api/status reports 8:00 PM IST schedule and live mode", async () => {
    const res = await fetch(`${BASE_URL}/api/status`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.scheduleIst, "20:00 IST");
    assert.equal(data.serverMode, "local-live");
  });

  test("GET /api/latest returns 100% bullet-summarized signals, drafts, and suppressed transparency list", async () => {
    const res = await fetch(`${BASE_URL}/api/latest`);
    assert.equal(res.status, 200);
    const ed = await res.json();
    assert.ok(ed.editionDate, "Missing editionDate");
    assert.ok(ed.stats.feedsOnline >= 15, `Expected >=15 online feeds, got ${ed.stats.feedsOnline}`);
    assert.ok(ed.stats.totalItems >= 10, `Expected >=10 curated signals, got ${ed.stats.totalItems}`);
    assert.ok(ed.topFive.length >= 3, "Expected topFive highlights");
    assert.ok(Array.isArray(ed.pendingDrafts) && ed.pendingDrafts.length >= 2, "Expected pending approval drafts");
    assert.ok(Array.isArray(ed.suppressedItems), "Expected suppressedItems array");

    for (const sec of ed.sections) {
      for (const item of sec.items) {
        assert.ok(Array.isArray(item.keyPoints) && item.keyPoints.length >= 1, `Missing keyPoints on: ${item.headline}`);
        assert.ok(item.branchImpact && item.branchImpact.length > 10, `Missing BM Action on: ${item.headline}`);
      }
    }
  });

  test("GET /api/editions and /api/edition/:date handle valid and invalid requests", async () => {
    const idxRes = await fetch(`${BASE_URL}/api/editions`);
    assert.equal(idxRes.status, 200);
    const idx = await idxRes.json();
    assert.ok(Array.isArray(idx.editions) && idx.editions.length >= 1);

    const dateKey = idx.editions[0].editionDate;
    const edRes = await fetch(`${BASE_URL}/api/edition/${dateKey}`);
    assert.equal(edRes.status, 200);

    const badRes = await fetch(`${BASE_URL}/api/edition/invalid-date`);
    assert.equal(badRes.status, 400);
  });

  test("GET /api/search returns accurate matches across archived editions", async () => {
    for (const q of ["RBI", "HDFC", "MCLR"]) {
      const res = await fetch(`${BASE_URL}/api/search?q=${encodeURIComponent(q)}`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.count >= 1, `Expected >=1 search match for "${q}"`);
    }
  });

  test("POST /api/ask routes commands to correct departments and queues approval drafts", async () => {
    const r1 = await fetch(`${BASE_URL}/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "What changed in HDFC Bank today?" }),
    });
    assert.equal(r1.status, 200);
    const a1 = await r1.json();
    assert.match(a1.department, /HDFC|Policies/i);
    assert.ok(a1.answerBullets.length >= 1);
    assert.equal(a1.suggestedDraft, null);

    const r2 = await fetch(`${BASE_URL}/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "Draft a WhatsApp message for my team on RBI KYC directions" }),
    });
    assert.equal(r2.status, 200);
    const a2 = await r2.json();
    assert.match(a2.department, /Huddle|Communications/i);
    assert.ok(a2.suggestedDraft && a2.suggestedDraft.body.includes("HDFC Bank Panchkula"));
  });

  test("GET/POST /api/audit persists human-in-the-loop actions", async () => {
    const postRes = await fetch(`${BASE_URL}/api/audit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "TEST_PING", department: "QA Harness", detail: "Automated test verification" }),
    });
    assert.equal(postRes.status, 200);

    const getRes = await fetch(`${BASE_URL}/api/audit`);
    assert.equal(getRes.status, 200);
    const data = await getRes.json();
    assert.ok(data.entries.some((e) => e.action === "TEST_PING"));
  });
});
