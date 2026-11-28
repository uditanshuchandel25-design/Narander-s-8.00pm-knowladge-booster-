/**
 * BM INTEL — Complete Real-User End-to-End Interactive Smoothness Test
 * Simulates every real Branch Manager journey in live headless Chrome across
 * iPhone (390x844), Android (412x915), and Desktop (1280x860):
 *  - Attention triage jumps & auto-filters
 *  - Command Centre Q&A + Draft queueing -> Review Draft -> Approvals edit/approve/dismiss
 *  - Brief tab bank filters, bookmarking & suppressed noise drawer
 *  - Archive keyword search, opening past editions & returning to latest
 *  - 4-digit PIN lock (enable -> reload lock -> wrong PIN reject -> right PIN unlock -> remove)
 *  - Live top-bar Sync button
 *  - Zero console errors, zero JS exceptions, zero failed HTTP requests!
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";

const TARGET_URL = process.env.BM_TEST_URL || "http://localhost:8080/?v=14";
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
      } else if (m.method === "Network.responseReceived" && m.params.response.status >= 400) {
        this.failedRequests.push(`${m.params.response.status} ${m.params.response.url}`);
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
      throw new Error(`Eval error: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description || ""}`);
    }
    return res.result?.value;
  }
  close() {
    try { this.ws.close(); } catch {}
  }
}

async function runE2E() {
  const bin = findBrowser();
  const port = 9255;
  const userDir = path.join(os.tmpdir(), `bm-e2e-profile-${Date.now()}`);
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
    assert.ok(wsUrl, "CDP WebSocket not available");

    cdp = new Cdp(wsUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");

    // 1. Multi-Viewport Responsive Check (iPhone 390, Android 412, Desktop 1280)
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.send("Page.navigate", { url: TARGET_URL });
    await sleep(1600);

    for (const vp of [
      { name: "iPhone 14 (390x844)", w: 390, h: 844, mobile: true },
      { name: "Android (412x915)", w: 412, h: 915, mobile: true },
      { name: "Desktop (1280x860)", w: 1280, h: 860, mobile: false },
    ]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile: vp.mobile });
      await sleep(200);
      const ov = await cdp.eval(`({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })`);
      assert.ok(ov.sw <= ov.iw, `Horizontal overflow on ${vp.name}: ${ov.sw} > ${ov.iw}`);
      console.log(`✔ Viewport ${vp.name}: smooth fit (${ov.sw}px <= ${ov.iw}px)`);
    }

    // Test Desktop Wide/Phone layout toggle
    await cdp.eval(`document.getElementById('layoutToggleBtn').click()`);
    const wideActive = await cdp.eval(`document.getElementById('appShell').classList.contains('wide-frame')`);
    assert.equal(wideActive, true, "Desktop Wide Desk layout toggle failed");
    await cdp.eval(`document.getElementById('layoutToggleBtn').click()`);
    console.log("✔ Desktop Phone/Wide Desk layout toggle works smoothly");

    // Switch to Mobile Android viewport for touch journey
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
    await sleep(150);

    // 2. Attention Triage Jump -> HDFC Filter Auto-Activation
    await cdp.eval(`document.querySelectorAll('#attentionRows .attention-row')[2].click()`);
    await sleep(250);
    const hdfcJump = await cdp.eval(`({
      activeTab: document.querySelector('.tab-panel.active')?.id,
      activeBank: document.querySelector('#bankFilterBar .chip.active')?.dataset?.bank,
      cardsShown: document.querySelectorAll('#sectionsContainer .intel-card').length,
    })`);
    assert.equal(hdfcJump.activeTab, "tab-brief");
    assert.equal(hdfcJump.activeBank, "HDFC");
    assert.ok(hdfcJump.cardsShown >= 1);
    console.log(`✔ Attention Triage -> HDFC Filter jump smooth (${hdfcJump.cardsShown} HDFC card shown)`);

    // 3. Brief Tab Filters, Bookmarking & Suppressed Noise Drawer
    await cdp.eval(`document.querySelector('#bankFilterBar .chip[data-bank="All"]').click()`);
    await sleep(150);
    const allCards = await cdp.eval(`document.querySelectorAll('#sectionsContainer .intel-card').length`);
    assert.ok(allCards >= 10);

    await cdp.eval(`document.querySelector('#sectionsContainer .bookmark-btn').click()`);
    await sleep(150);
    const savedText = await cdp.eval(`document.querySelector('#sectionsContainer .bookmark-btn').textContent.trim()`);
    assert.match(savedText, /Saved/);

    await cdp.eval(`document.querySelector('#suppressedDrawer summary').click()`);
    await sleep(150);
    const drawerOpen = await cdp.eval(`({ open: document.getElementById('suppressedDrawer').open, rows: document.querySelectorAll('#suppressedList .suppressed-row').length })`);
    assert.equal(drawerOpen.open, true);
    assert.ok(drawerOpen.rows >= 5);
    console.log(`✔ Brief tab filters (${allCards} cards), Bookmark save & Filtered-Noise drawer (${drawerOpen.rows} items) smooth`);

    // 4. Command Centre Draft Creation -> Review Draft -> Approvals Gate Edit, Approve & Dismiss
    await cdp.eval(`document.querySelector('.dock-btn[data-tab="command"]').click()`);
    await sleep(150);
    await cdp.eval(`document.querySelector('#commandPresets .prompt-chip:last-child').click()`);
    await sleep(600);
    const draftJumpVisible = await cdp.eval(`Boolean(document.getElementById('jumpToApprovalBtn'))`);
    assert.equal(draftJumpVisible, true, "Review Draft button did not appear");
    await cdp.eval(`document.getElementById('jumpToApprovalBtn').click()`);
    await sleep(250);

    const beforePending = await cdp.eval(`Number(document.getElementById('approvalsNavBadge').textContent || 0)`);
    assert.ok(beforePending >= 3);

    // Edit & approve first draft, then dismiss it cleanly
    await cdp.eval(`(() => {
      const ta = document.querySelector('#approvalsList textarea');
      ta.value = ta.value + '\\nChecked by BM.';
      document.querySelector('#approvalsList [data-approve]').click();
    })()`);
    await sleep(300);
    const afterApprove = await cdp.eval(`({
      badge: Number(document.getElementById('approvalsNavBadge').textContent || 0),
      statusText: document.querySelector('#approvalsList .approval-status')?.textContent?.trim(),
      bmCount: Number(document.getElementById('bookmarkCount').textContent || 0),
    })`);
    assert.equal(afterApprove.badge, beforePending - 1);
    assert.match(afterApprove.statusText, /Approved/);
    assert.equal(afterApprove.bmCount, 1);

    // Clean up test custom draft & bookmark
    await cdp.eval(`document.querySelector('#approvalsList [data-dismiss]').click()`);
    await cdp.eval(`document.getElementById('clearBookmarksBtn').click()`);
    await sleep(200);
    const bmCleared = await cdp.eval(`Number(document.getElementById('bookmarkCount').textContent)`);
    assert.equal(bmCleared, 0);
    console.log(`✔ Command Draft -> Approvals Edit/Approve/Dismiss & Bookmarks lifecycle smooth`);

    // 5. System Tab: Archive Search + Past Edition Switching + Return to Latest
    await cdp.eval(`document.querySelector('.dock-btn[data-tab="system"]').click()`);
    await sleep(200);
    await cdp.eval(`document.querySelector('#quickSearchChips .chip[data-q="RBI"]').click()`);
    await sleep(350);
    const searchCount = await cdp.eval(`document.querySelectorAll('#searchResultsList .intel-card').length`);
    assert.ok(searchCount >= 3, `Expected >=3 RBI archive search cards, got ${searchCount}`);
    await cdp.eval(`document.getElementById('searchClearBtn').click()`);
    await sleep(150);

    const editionCount = await cdp.eval(`document.querySelectorAll('#editionsList .edition-row').length`);
    if (editionCount >= 2) {
      await cdp.eval(`document.querySelectorAll('#editionsList .edition-row')[1].click()`);
      await sleep(350);
      const bannerShown = await cdp.eval(`!document.getElementById('archiveBanner').classList.contains('hidden')`);
      assert.equal(bannerShown, true, "Archive banner should show when opening past edition");
      await cdp.eval(`document.getElementById('returnLatestBtn').click()`);
      await sleep(250);
      const bannerHidden = await cdp.eval(`document.getElementById('archiveBanner').classList.contains('hidden')`);
      assert.equal(bannerHidden, true, "Archive banner should hide after returning to latest");
      console.log(`✔ Archive Search (${searchCount} RBI matches) + Past Edition switch & Latest restore smooth`);
    } else {
      console.log(`✔ Archive Search (${searchCount} RBI matches) smooth`);
    }

    // 6. 4-Digit Personal PIN Lock Full Cycle (Enable -> Reload -> Wrong PIN -> Right PIN -> Remove)
    await cdp.eval(`document.querySelector('.dock-btn[data-tab="system"]').click()`);
    await sleep(150);
    await cdp.eval(`(() => {
      document.getElementById('newPinInput').value = '2026';
      document.getElementById('savePinBtn').click();
    })()`);
    await sleep(200);
    await cdp.send("Page.reload", { ignoreCache: true });
    await sleep(1400);

    const locked = await cdp.eval(`!document.getElementById('pinOverlay').classList.contains('hidden')`);
    assert.equal(locked, true, "PIN overlay did not lock on reload");

    await cdp.eval(`(() => {
      document.getElementById('pinInput').value = '1111';
      document.getElementById('pinUnlockBtn').click();
    })()`);
    await sleep(100);
    const wrongErr = await cdp.eval(`document.getElementById('pinError').textContent`);
    assert.match(wrongErr, /Incorrect/i);

    await cdp.eval(`(() => {
      document.getElementById('pinInput').value = '2026';
      document.getElementById('pinUnlockBtn').click();
    })()`);
    await sleep(150);
    const unlocked = await cdp.eval(`document.getElementById('pinOverlay').classList.contains('hidden')`);
    assert.equal(unlocked, true, "Correct PIN failed to unlock");

    await cdp.eval(`document.querySelector('.dock-btn[data-tab="system"]').click()`);
    await sleep(100);
    await cdp.eval(`document.getElementById('removePinBtn').click()`);
    console.log("✔ 4-Digit Personal PIN Lock cycle (Enable → Lock → Reject Wrong → Unlock → Remove) smooth");

    // 7. Live Sync Button End-to-End Test
    const syncStart = performance.now();
    await cdp.eval(`document.getElementById('refreshBtn').click()`);
    for (let i = 0; i < 45; i++) {
      await sleep(400);
      const loading = await cdp.eval(`document.getElementById('refreshBtn').classList.contains('loading')`);
      if (!loading) break;
    }
    const syncMs = Math.round(performance.now() - syncStart);
    const stillLoading = await cdp.eval(`document.getElementById('refreshBtn').classList.contains('loading')`);
    assert.equal(stillLoading, false, "Sync button stayed stuck in loading state!");
    console.log(`✔ Live Sync button completed cleanly in ${syncMs} ms`);

    // 8. Final Zero-Error Audit
    assert.deepEqual(cdp.exceptions, [], `Uncaught exceptions: ${cdp.exceptions.join("; ")}`);
    assert.deepEqual(cdp.consoleErrors, [], `Console errors: ${cdp.consoleErrors.join("; ")}`);
    assert.deepEqual(cdp.failedRequests, [], `Failed HTTP requests: ${cdp.failedRequests.join("; ")}`);

    console.log("\n====================================================================");
    console.log("  ✅ EVERY INTERACTIVE USER JOURNEY PASSED SMOOTHLY (0 ERRORS)!");
    console.log("====================================================================");
  } finally {
    cdp?.close();
    try { proc.kill("SIGKILL"); } catch {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  }
}

runE2E().catch((err) => {
  console.error("\n❌ E2E SMOOTHNESS TEST FAILED:", err);
  process.exit(1);
});
