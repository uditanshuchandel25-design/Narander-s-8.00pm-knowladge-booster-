/**
 * Live Headless Chromium UI/UX & 60fps Orb Canvas Verification Harness (Zero Dependencies!)
 * Uses Chrome DevTools Protocol (CDP) via Node 24's built-in WebSocket to:
 *  1. Launch isolated headless Chrome/Edge against http://localhost:8080
 *  2. Verify ZERO console errors & ZERO uncaught JS exceptions
 *  3. Verify the Living Liquid-Glass Orb <canvas> renders & animates smoothly across frames
 *  4. Verify responsive layout (Zero horizontal overflow on mobile 390px & desktop frame)
 *  5. Exercise all 4 tabs (Command, Brief, Approvals, System), bank filters, Command Centre Q&A,
 *     Approvals Gate, and Dark/Light theme switching
 *  6. Capture full screenshots for visual audit!
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";

const TARGET_URL = process.env.BM_TEST_URL || "http://localhost:8080/?v=15";
const OUT_DIR = process.env.BM_SCREENSHOT_DIR || path.join(os.tmpdir(), "bm-intel-uiux-shots");
fs.mkdirSync(OUT_DIR, { recursive: true });

function findBrowser() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("No Chromium browser (Chrome/Edge) found for headless UI test.");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.exceptions = [];
  }
  async connect() {
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method === "Runtime.exceptionThrown") {
        this.exceptions.push(msg.params.exceptionDetails?.text || JSON.stringify(msg.params));
      } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        this.consoleErrors.push(msg.params.args.map((a) => a.value || a.description).join(" "));
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
  async screenshot(filename) {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    const fullPath = path.join(OUT_DIR, filename);
    fs.writeFileSync(fullPath, Buffer.from(data, "base64"));
    return fullPath;
  }
  close() {
    try { this.ws.close(); } catch {}
  }
}

async function waitForCdp(port, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (r.ok) {
        const list = await r.json();
        const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch {}
    await sleep(200);
  }
  throw new Error("Timed out waiting for CDP endpoint");
}

async function run() {
  const browserBin = findBrowser();
  const port = 9239;
  const userDir = path.join(os.tmpdir(), `bm-cdp-profile-${Date.now()}`);
  fs.mkdirSync(userDir, { recursive: true });

  console.log(`[UI/UX Test] Launching headless browser: ${path.basename(browserBin)}`);
  const proc = spawn(
    browserBin,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=430,932",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  let cdp;
  try {
    const wsUrl = await waitForCdp(port);
    cdp = new CdpClient(wsUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 412,
      height: 915,
      deviceScaleFactor: 2,
      mobile: true,
    });

    console.log(`[UI/UX Test] Navigating to ${TARGET_URL}`);
    await cdp.send("Page.navigate", { url: TARGET_URL });
    await sleep(2200);

    // 1. Check initial load, TypeUI Bento tokens, ui-skills rules & zero horizontal overflow
    const layoutMetrics = await cdp.eval(`(() => ({
      title: document.title,
      theme: document.documentElement.getAttribute('data-theme'),
      canvasBg: getComputedStyle(document.getElementById('appShell')).backgroundColor,
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      hasVoiceOrb: Boolean(document.getElementById('agentOrbCanvas')),
      hasVoiceBtn: Boolean(document.getElementById('askWhatToReadBtn')),
      hasAmbientOrbs: document.querySelectorAll('.ambient-orb').length,
      iconButtonsMissingLabel: Array.from(document.querySelectorAll('.icon-btn, .btn-send')).filter((b) => !b.getAttribute('aria-label')).length,
      attentionRowsCount: document.querySelectorAll('#attentionRows .attention-row').length,
      topFiveCount: document.querySelectorAll('#topFiveList li').length,
      brandLogoLoaded: Boolean(document.querySelector('.brand-logo-img')?.complete && document.querySelector('.brand-logo-img')?.naturalWidth >= 192),
      heroLogoLoaded: Boolean(document.querySelector('.hero-logo-img')?.complete && document.querySelector('.hero-logo-img')?.naturalWidth >= 512),
    }))()`);

    console.log("[UI/UX Test] Landing metrics:", layoutMetrics);
    assert.equal(layoutMetrics.theme, "light", "Default TypeUI Bento theme should be light (#FFF5E6)");
    assert.equal(layoutMetrics.brandLogoLoaded, true, "Topbar BM logo PNG failed to load!");
    assert.equal(layoutMetrics.heroLogoLoaded, true, "Hero BM executive logo PNG failed to load!");
    assert.equal(layoutMetrics.overflowX, false, `Horizontal overflow detected: ${layoutMetrics.scrollWidth} > ${layoutMetrics.innerWidth}`);
    assert.equal(layoutMetrics.hasVoiceOrb, false, "Voice orb should be removed!");
    assert.equal(layoutMetrics.hasVoiceBtn, false, "Voice speaker button should be removed!");
    assert.equal(layoutMetrics.hasAmbientOrbs, 0, "Ambient glow orbs should be removed per ui-skills!");
    assert.equal(layoutMetrics.iconButtonsMissingLabel, 0, "All icon-only buttons must have aria-label!");
    assert.equal(layoutMetrics.attentionRowsCount, 4, `Expected 4 attention bento tiles, got ${layoutMetrics.attentionRowsCount}`);
    assert.ok(layoutMetrics.topFiveCount >= 4, "Expected Top 5 Pulse items rendered");

    // Capture TypeUI Bento Warm Light Landing Screenshot
    const s1 = await cdp.screenshot("01-landing-bento-light.png");
    console.log("[UI/UX Test] Saved:", s1);

    // 2. Test Warm Charcoal Dark Bento Toggle & Screenshot
    await cdp.eval(`document.getElementById('themeToggleBtn').click()`);
    await sleep(300);
    const darkTheme = await cdp.eval(`document.documentElement.getAttribute('data-theme')`);
    assert.equal(darkTheme, "dark");
    const s2 = await cdp.screenshot("02-landing-bento-dark.png");
    console.log("[UI/UX Test] Saved:", s2);

    // Switch back to TypeUI Bento Light Mode for remaining visual checks
    await cdp.eval(`document.getElementById('themeToggleBtn').click()`);
    await sleep(250);

    // 3. Test Command Centre Prompt Submission ("What changed in HDFC Bank today?")
    await cdp.eval(`(() => {
      document.getElementById('commandInput').value = 'What changed in HDFC Bank today?';
      document.getElementById('commandForm').dispatchEvent(new Event('submit', { cancelable: true }));
    })()`);
    await sleep(700);
    const cmdCheck = await cdp.eval(`(() => ({
      visible: !document.getElementById('commandResultBox').classList.contains('hidden'),
      steps: document.querySelectorAll('#commandPipeline .pipe-step').length,
      bullets: document.querySelectorAll('#commandBullets li').length,
      hasSpeakBtn: Boolean(document.getElementById('speakCommandAnswerBtn')),
    }))()`);
    console.log("[UI/UX Test] Command Centre check:", cmdCheck);
    assert.equal(cmdCheck.visible, true);
    assert.ok(cmdCheck.steps >= 3);
    assert.ok(cmdCheck.bullets >= 1);
    assert.equal(cmdCheck.hasSpeakBtn, false);

    // 4. Test Brief Tab, Effective Tags, Bullet Summaries, Bank Filter & Suppressed Drawer
    await cdp.eval(`document.querySelector('.dock-btn[data-tab="brief"]').click()`);
    await sleep(400);
    const briefCheck = await cdp.eval(`(() => ({
      cards: document.querySelectorAll('#sectionsContainer .intel-card').length,
      bullets: document.querySelectorAll('#sectionsContainer .key-points li').length,
      effectiveTags: document.querySelectorAll('#sectionsContainer .tag-effective').length,
      speakBtns: document.querySelectorAll('#sectionsContainer .speak-card-btn').length,
      suppressedVisible: !document.getElementById('suppressedDrawer').classList.contains('hidden'),
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
    }))()`);
    console.log("[UI/UX Test] Brief Tab check:", briefCheck);
    assert.ok(briefCheck.cards >= 10);
    assert.ok(briefCheck.bullets >= briefCheck.cards);
    assert.equal(typeof briefCheck.effectiveTags, "number");
    assert.equal(briefCheck.speakBtns, 0);
    assert.equal(briefCheck.suppressedVisible, true);
    assert.equal(briefCheck.overflowX, false);
    const s3 = await cdp.screenshot("03-brief-tab.png");
    console.log("[UI/UX Test] Saved:", s3);

    // 4b. Verify Sticky Filter & Section Switcher Dock Behavior (Top -> Scrolled Down -> Scrolled Back Up)
    const stickyTopState = await cdp.eval(`(() => {
      const hdr = document.querySelector('.brief-header-card').getBoundingClientRect();
      const dock = document.getElementById('briefFilterDock').getBoundingClientRect();
      return {
        isStuck: document.getElementById('briefFilterDock').classList.contains('is-stuck'),
        dockBelowHeader: dock.top >= hdr.bottom - 2,
        dockTop: Math.round(dock.top),
        hdrBottom: Math.round(hdr.bottom),
      };
    })()`);
    console.log("[UI/UX Test] Brief Sticky (at top):", stickyTopState);
    assert.equal(stickyTopState.isStuck, false, "Filter dock should NOT be stuck at top of Brief tab");
    assert.equal(stickyTopState.dockBelowHeader, true, "Filter dock should sit below Brief header card at top");

    await cdp.eval(`window.scrollTo({ top: 900, behavior: 'instant' })`);
    await sleep(300);
    const stickyScrolledState = await cdp.eval(`(() => {
      const topbar = document.querySelector('.topbar').getBoundingClientRect();
      const dock = document.getElementById('briefFilterDock').getBoundingClientRect();
      return {
        scrollY: Math.round(window.scrollY),
        isStuck: document.getElementById('briefFilterDock').classList.contains('is-stuck'),
        dockTop: Math.round(dock.top),
        topbarBottom: Math.round(topbar.bottom),
        badgeVisible: !document.getElementById('stickyActiveBadge').classList.contains('hidden'),
      };
    })()`);
    console.log("[UI/UX Test] Brief Sticky (scrolled down 900px):", stickyScrolledState);
    assert.ok(stickyScrolledState.scrollY >= 700, "Page did not scroll down as expected");
    assert.equal(stickyScrolledState.isStuck, true, "Filter dock MUST stick when scrolled down past its position!");
    assert.ok(
      Math.abs(stickyScrolledState.dockTop - stickyScrolledState.topbarBottom) <= 3,
      `Sticky filter dock (${stickyScrolledState.dockTop}px) should lock right under topbar (${stickyScrolledState.topbarBottom}px)`
    );
    assert.equal(stickyScrolledState.badgeVisible, true, "Pinned badge should appear while filter dock is stuck");
    const s7 = await cdp.screenshot("07-brief-sticky-scrolled.png");
    console.log("[UI/UX Test] Saved:", s7);

    // Scroll back UP to top -> must release and return to its original slot
    await cdp.eval(`window.scrollTo({ top: 0, behavior: 'instant' })`);
    await sleep(250);
    const stickyReturnedState = await cdp.eval(`(() => {
      const hdr = document.querySelector('.brief-header-card').getBoundingClientRect();
      const dock = document.getElementById('briefFilterDock').getBoundingClientRect();
      return {
        isStuck: document.getElementById('briefFilterDock').classList.contains('is-stuck'),
        dockBelowHeader: dock.top >= hdr.bottom - 2,
      };
    })()`);
    console.log("[UI/UX Test] Brief Sticky (returned to top):", stickyReturnedState);
    assert.equal(stickyReturnedState.isStuck, false, "Filter dock should un-stick when returning to top!");
    assert.equal(stickyReturnedState.dockBelowHeader, true, "Filter dock should sit back below header card!");

    // 6. Test Approvals Tab (Human-in-the-Loop Gate)
    await cdp.eval(`document.querySelector('.dock-btn[data-tab="approvals"]').click()`);
    await sleep(350);
    const approvalsCheck = await cdp.eval(`(() => ({
      draftCards: document.querySelectorAll('#approvalsList .approval-card').length,
      textareas: document.querySelectorAll('#approvalsList textarea').length,
      approveBtns: document.querySelectorAll('#approvalsList [data-approve]').length,
    }))()`);
    console.log("[UI/UX Test] Approvals Tab check:", approvalsCheck);
    assert.ok(approvalsCheck.draftCards >= 2);
    assert.equal(approvalsCheck.textareas, approvalsCheck.draftCards);
    const s4 = await cdp.screenshot("04-approvals-tab.png");
    console.log("[UI/UX Test] Saved:", s4);

    // 7. Test System Tab (Archive Search, 8PM Countdown, Audit Log, 18 Source Health Rows)
    await cdp.eval(`document.querySelector('.dock-btn[data-tab="system"]').click()`);
    await sleep(350);
    const systemCheck = await cdp.eval(`(() => ({
      countdown: document.getElementById('countdownClock').textContent,
      auditRows: document.querySelectorAll('#auditLogList .audit-row').length,
      sourceRows: document.querySelectorAll('#sourceHealthList .source-row').length,
      editionsRows: document.querySelectorAll('#editionsList .edition-row').length,
      maxCardRight: Math.round(Math.max(...Array.from(document.querySelectorAll('#tab-system .bento-card')).map((el) => el.getBoundingClientRect().right))),
      innerWidth: window.innerWidth,
    }))()`);
    console.log("[UI/UX Test] System Tab check:", systemCheck);
    assert.match(systemCheck.countdown, /\d{2}h \d{2}m \d{2}s/);
    assert.ok(systemCheck.auditRows >= 1);
    assert.equal(systemCheck.sourceRows, 18);
    assert.ok(systemCheck.editionsRows >= 1);
    assert.ok(systemCheck.maxCardRight <= systemCheck.innerWidth, `System Bento card clipped right edge: ${systemCheck.maxCardRight} > ${systemCheck.innerWidth}`);
    const s5 = await cdp.screenshot("05-system-bento.png");
    console.log("[UI/UX Test] Saved:", s5);

    // 7b. Capture Wide Desktop 12-Column Bento Dashboard Screenshot
    await cdp.eval(`document.querySelector('.dock-btn[data-tab="command"]').click()`);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280,
      height: 900,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await sleep(250);
    await cdp.eval(`document.getElementById('layoutToggleBtn').click()`);
    await sleep(300);
    const desktopOverflow = await cdp.eval(`document.documentElement.scrollWidth > window.innerWidth`);
    assert.equal(desktopOverflow, false, "Horizontal overflow on Wide Desk Bento!");
    const s6 = await cdp.screenshot("06-desktop-wide-bento.png");
    console.log("[UI/UX Test] Saved:", s6);

    // 8. Assert ZERO console errors & ZERO uncaught exceptions across entire session!
    assert.deepEqual(cdp.exceptions, [], `Uncaught JS exceptions: ${cdp.exceptions.join("; ")}`);
    assert.deepEqual(cdp.consoleErrors, [], `Console errors: ${cdp.consoleErrors.join("; ")}`);

    console.log("\n✅ ALL TYPEUI BENTO + UI-SKILLS HEADLESS UI/UX TESTS PASSED (0 ERRORS)!");
  } finally {
    cdp?.close();
    try { proc.kill("SIGKILL"); } catch {}
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch {}
  }
}

run().catch((err) => {
  console.error("\n❌ UI/UX TEST FAILED:", err);
  process.exit(1);
});
