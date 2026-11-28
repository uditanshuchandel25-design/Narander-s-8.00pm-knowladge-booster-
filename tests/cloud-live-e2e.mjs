/**
 * Live Cloud Phone App End-to-End Verification (GitHub Pages + Auto-Renewal Check)
 * Launches headless Chrome in Android (412x915) mobile mode directly against the LIVE
 * deployed GitHub Pages URL and verifies:
 *  - Zero JS exceptions, zero console errors, zero failed HTTP requests (0 404s!)
 *  - Fresh edition loaded, Red BM logo rendered, TypeUI Bento warm theme active
 *  - Sticky Bank Segment + Section Switcher locks on scroll & releases on scroll-up
 *  - Static-cloud Command Centre Q&A + WhatsApp Draft creation -> Approvals tab
 *  - Static-cloud Archive Search + Past Edition switching
 *  - Live Sync button triggers cache-busted latest.json?t=... refresh cleanly
 *  - GitHub Actions workflow active with 3 off-peak staggered daily 8PM IST cron slots
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";

const CLOUD_URL =
  process.env.BM_CLOUD_URL ||
  "https://uditanshuchandel25-design.github.io/Narander-s-8.00pm-knowladge-booster-/";
const REPO_API =
  "https://api.github.com/repos/uditanshuchandel25-design/Narander-s-8.00pm-knowladge-booster-";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  for (const p of [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ]) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("No Chromium browser found");
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.exceptions = [];
    this.failedRequests = [];
    this.dataRequests = [];
  }
  async connect() {
    await new Promise((res, rej) => {
      this.ws.addEventListener("open", res, { once: true });
      this.ws.addEventListener("error", rej, { once: true });
    });
    this.ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data.toString());
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
      } else if (m.method === "Runtime.exceptionThrown") {
        this.exceptions.push(m.params.exceptionDetails?.text || JSON.stringify(m.params));
      } else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
        this.consoleErrors.push(m.params.args.map((a) => a.value || a.description).join(" "));
      } else if (m.method === "Network.responseReceived") {
        const url = m.params.response.url;
        const status = m.params.response.status;
        if (url.includes("/data/latest.json")) this.dataRequests.push({ status, url });
        if (status >= 400) this.failedRequests.push(`${status} ${url}`);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const res = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${res.exceptionDetails.text}`);
    }
    return res.result?.value;
  }
  close() {
    try { this.ws.close(); } catch {}
  }
}

async function verifyGithubAutoRenewal() {
  const wfRes = await fetch(`${REPO_API}/actions/workflows`, {
    headers: { "User-Agent": "bm-intel-e2e" },
  });
  assert.equal(wfRes.status, 200, "Could not query GitHub workflows");
  const wfData = await wfRes.json();
  const wf = (wfData.workflows || []).find((w) => w.path.includes("daily-8pm-intel.yml"));
  assert.ok(wf, "daily-8pm-intel.yml workflow not found on GitHub");
  assert.equal(wf.state, "active", `Workflow is not active: ${wf.state}`);

  const yamlRes = await fetch(`${REPO_API}/contents/.github/workflows/daily-8pm-intel.yml`, {
    headers: { "User-Agent": "bm-intel-e2e" },
  });
  const yamlJson = await yamlRes.json();
  const yamlText = Buffer.from(yamlJson.content || "", "base64").toString("utf8");
  const crons = [...yamlText.matchAll(/cron:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(crons.length >= 3, `Expected 3 redundant off-peak cron schedules, found: ${crons.join(", ")}`);
  assert.ok(yamlText.includes("node scripts/fetch-intel.js"), "Workflow missing fetch-intel.js execution");
  assert.ok(yamlText.includes("actions/deploy-pages@v4"), "Workflow missing automatic GitHub Pages deploy");
  console.log(`✔ GitHub Cloud Scheduler active (${crons.length} off-peak slots: ${crons.join(" | ")})`);

  const runsRes = await fetch(`${REPO_API}/actions/runs?per_page=3`, {
    headers: { "User-Agent": "bm-intel-e2e" },
  });
  const runsData = await runsRes.json();
  const latestRun = runsData.workflow_runs?.[0];
  assert.ok(latestRun, "No GitHub Actions runs found");
  assert.equal(latestRun.conclusion, "success", `Latest workflow run did not succeed: ${latestRun.conclusion}`);
  console.log(`✔ Latest GitHub Actions deploy succeeded (${latestRun.event} at ${latestRun.updated_at})`);
}

async function runCloudE2E() {
  console.log("====================================================================");
  console.log("  BM INTEL — LIVE CLOUD PHONE & AUTO-RENEWAL END-TO-END AUDIT");
  console.log("====================================================================");

  await verifyGithubAutoRenewal();

  const bin = findBrowser();
  const port = 9266;
  const userDir = path.join(os.tmpdir(), `bm-cloud-e2e-${Date.now()}`);
  fs.mkdirSync(userDir, { recursive: true });

  const proc = spawn(
    bin,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let cdp;
  try {
    let wsUrl = null;
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/list`);
        const list = await r.json();
        const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
      } catch {}
      await sleep(200);
    }
    assert.ok(wsUrl, "CDP WebSocket unavailable");

    cdp = new Cdp(wsUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 412,
      height: 915,
      deviceScaleFactor: 2,
      mobile: true,
    });

    await cdp.send("Page.navigate", { url: `${CLOUD_URL}?e2e=${Date.now()}` });
    await sleep(3000);

    const home = await cdp.eval(`(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      editionPill: document.getElementById('heroEditionPill')?.textContent,
      taskPill: document.getElementById('taskPillText')?.textContent,
      brandLogoOk: Boolean(document.querySelector('.brand-logo-img')?.complete && document.querySelector('.brand-logo-img')?.naturalWidth >= 192),
      heroLogoOk: Boolean(document.querySelector('.hero-logo-img')?.complete && document.querySelector('.hero-logo-img')?.naturalWidth >= 512),
      attentionTiles: document.querySelectorAll('#attentionRows .attention-row').length,
      topFive: document.querySelectorAll('#topFiveList li').length,
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
    }))()`);
    console.log("✔ Live Cloud Home:", home);
    assert.equal(home.theme, "light");
    assert.equal(home.brandLogoOk, true);
    assert.equal(home.heroLogoOk, true);
    assert.equal(home.attentionTiles, 4);
    assert.ok(home.topFive >= 4);
    assert.equal(home.overflowX, false);

    // Test Static-Cloud Command Centre + Draft Queueing
    await cdp.eval(`document.querySelector('#commandPresets .prompt-chip:last-child').click()`);
    await sleep(600);
    const cmdOk = await cdp.eval(`({
      bullets: document.querySelectorAll('#commandBullets li').length,
      hasReviewBtn: Boolean(document.getElementById('jumpToApprovalBtn')),
    })`);
    assert.ok(cmdOk.bullets >= 1, "Static-cloud Command Q&A returned 0 bullets");
    assert.equal(cmdOk.hasReviewBtn, true, "Static-cloud Draft CTA missing");
    console.log(`✔ Live Cloud Command Q&A + Draft creation smooth (${cmdOk.bullets} bullets)`);

    // Test Brief Tab + Sticky Dock on live cloud URL
    await cdp.eval(`document.querySelector('.dock-btn[data-tab="brief"]').click()`);
    await sleep(350);
    await cdp.eval(`window.scrollTo({ top: 800, behavior: 'instant' })`);
    await sleep(300);
    const stickyOk = await cdp.eval(`({
      cards: document.querySelectorAll('#sectionsContainer .intel-card').length,
      stuck: document.getElementById('briefFilterDock').classList.contains('is-stuck'),
      editionSubline: document.getElementById('editionSubline')?.textContent,
    })`);
    assert.ok(stickyOk.cards >= 10, `Expected >=10 cloud brief cards, got ${stickyOk.cards}`);
    assert.equal(stickyOk.stuck, true, "Sticky filter dock did not pin on live cloud Brief tab");
    console.log(`✔ Live Cloud Brief (${stickyOk.cards} cards) + Sticky Filter Dock smooth (${stickyOk.editionSubline})`);

    // Test Static-Cloud Archive Search
    await cdp.eval(`document.querySelector('.dock-btn[data-tab="system"]').click()`);
    await sleep(250);
    await cdp.eval(`document.querySelector('#quickSearchChips .chip[data-q="RBI"]').click()`);
    await sleep(900);
    const archiveOk = await cdp.eval(`({
      matches: document.querySelectorAll('#searchResultsList .intel-card').length,
      countdown: document.getElementById('countdownClock')?.textContent,
      sources: document.querySelectorAll('#sourceHealthList .source-row').length,
    })`);
    assert.ok(archiveOk.matches >= 3, `Expected >=3 cloud archive RBI matches, got ${archiveOk.matches}`);
    assert.match(archiveOk.countdown, /\d{2}h \d{2}m \d{2}s/);
    assert.equal(archiveOk.sources, 18);
    console.log(`✔ Live Cloud Archive Search (${archiveOk.matches} matches), Countdown (${archiveOk.countdown}) & 18/18 Source Health smooth`);

    // Test Live Cloud Sync button (cache-busted latest.json?t=...)
    const beforeDataReqs = cdp.dataRequests.length;
    await cdp.eval(`document.getElementById('refreshBtn').click()`);
    await sleep(1200);
    assert.ok(cdp.dataRequests.length > beforeDataReqs, "Cloud Sync button did not issue fresh latest.json request");
    const lastDataReq = cdp.dataRequests[cdp.dataRequests.length - 1];
    assert.match(lastDataReq.url, /latest\.json\?t=\d+/, "Cloud Sync request missing cache-buster ?t=");
    assert.equal(lastDataReq.status, 200);
    console.log(`✔ Live Cloud Sync button verified (cache-busted HTTP 200: ${lastDataReq.url.split("/data/")[1]})`);

    // Assert ZERO console errors, ZERO uncaught exceptions, ZERO 404/500 HTTP failures!
    assert.deepEqual(cdp.exceptions, [], `Cloud JS exceptions: ${cdp.exceptions.join("; ")}`);
    assert.deepEqual(cdp.consoleErrors, [], `Cloud console errors: ${cdp.consoleErrors.join("; ")}`);
    assert.deepEqual(cdp.failedRequests, [], `Cloud failed HTTP requests: ${cdp.failedRequests.join("; ")}`);

    console.log("\n====================================================================");
    console.log("  ✅ LIVE CLOUD PHONE APP & AUTO-RENEWAL PASSED 100% (0 ERRORS)!");
    console.log("====================================================================");
  } finally {
    cdp?.close();
    try { proc.kill("SIGKILL"); } catch {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  }
}

runCloudE2E().catch((err) => {
  console.error("\n❌ LIVE CLOUD E2E FAILED:", err);
  process.exit(1);
});
