/**
 * BM INTEL — TypeUI Bento Executive Command Centre Client (ui-skills compliant)
 * Features:
 *  - Modular TypeUI Bento Grid + "NEEDS YOUR ATTENTION" live 2x2 triage matrix
 *  - Command Centre ("Ask BM Intel") with department routing & draft creation
 *  - 100% Deep-Summarized 24h Brief with Bank & Insurance filters
 *  - Human-in-the-Loop Approvals Gate (Asks Before It Acts)
 *  - Persistent Audit Log, Archive Search & Offline PWA Cache
 */

const BANK_FILTERS = ["All", "HDFC", "Private", "PSU/Govt", "Semi-Govt", "International"];
const INSURANCE_FILTERS = ["All", "Life", "Term", "Health", "Non-Life", "IRDAI / All"];
const BOOKMARK_KEY = "bm_intel_bookmarks_v1";
const APPROVAL_STATE_KEY = "bm_intel_approval_states_v1";
const CUSTOM_DRAFTS_KEY = "bm_intel_custom_drafts_v1";
const THEME_KEY = "bm_intel_theme_v3";
const LAYOUT_KEY = "bm_intel_layout_v1";

const state = {
  latestEdition: null,
  activeEdition: null,
  isViewingArchive: false,
  editionsIndex: [],
  auditEntries: [],
  selectedBank: "All",
  selectedInsuranceSub: "All",
  serverMode: "static",
  bookmarks: loadJson(BOOKMARK_KEY, []),
  approvalStatus: loadJson(APPROVAL_STATE_KEY, {}),
  customDrafts: loadJson(CUSTOM_DRAFTS_KEY, []),
};

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function saveJson(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

function esc(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatInlineBold(str = "") {
  return esc(str).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => el.classList.add("hidden"), 2600);
}

function setRunningTask(busy, label, progressPct = null) {
  const pill = document.getElementById("taskPill");
  const text = document.getElementById("taskPillText");
  const bar = document.getElementById("liveProgressBar");
  pill.classList.toggle("busy", busy);
  text.textContent = label;
  if (progressPct !== null && bar) {
    const ratio = Math.max(0, Math.min(1, progressPct / 100));
    bar.style.transform = `scaleX(${ratio})`;
  }
}

function updateDynamicGreeting() {
  const now = new Date();
  const istHour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(now)
  );
  const el = document.getElementById("greetingPhrase");
  if (!el) return;
  if (istHour >= 5 && istHour < 12) {
    el.textContent = "has your morning huddle ready";
  } else if (istHour >= 12 && istHour < 17) {
    el.textContent = "has your midday desk ready";
  } else {
    el.textContent = "has your evening brief ready";
  }
}

// --- Data Layer ---
let lastCloudLoadMs = 0;
const IS_STATIC_CLOUD_HOST = /\.(github\.io|netlify\.app|pages\.dev|vercel\.app)$/i.test(window.location.hostname);

async function fetchJsonWithFallback(apiPath, staticPath) {
  if (!IS_STATIC_CLOUD_HOST) {
    try {
      const res = await fetch(apiPath, { cache: "no-store" });
      const ct = res.headers.get("content-type") || "";
      if (res.ok && ct.includes("json")) return { data: await res.json(), via: "api" };
    } catch {
      // Fallback to static
    }
  }
  const sep = staticPath.includes("?") ? "&" : "?";
  const res2 = await fetch(`${staticPath}${sep}t=${Date.now()}`, { cache: "no-store" });
  if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
  return { data: await res2.json(), via: "static" };
}

function formatShortUpdatedLabel(edition) {
  const raw = edition?.editionLabel || "";
  const timeMatch = raw.match(/(\d{1,2}:\d{2}\s*(?:am|pm)\s*IST)/i);
  return timeMatch ? timeMatch[1].toUpperCase() : "20:00 IST";
}

async function loadInitialData() {
  setRunningTask(true, "Loading verified 24h desk…", 45);
  try {
    const [latestRes, indexRes] = await Promise.all([
      fetchJsonWithFallback("./api/latest", "./data/latest.json"),
      fetchJsonWithFallback("./api/editions", "./data/index.json"),
    ]);
    lastCloudLoadMs = Date.now();
    state.serverMode = latestRes.via === "api" ? "local-live" : "static-cloud";
    state.latestEdition = latestRes.data;
    state.activeEdition = latestRes.data;
    state.isViewingArchive = false;
    state.editionsIndex = indexRes.data.editions || [];

    await loadAuditLog();
    renderAll();

    const s = state.activeEdition.stats || {};
    const updatedShort = formatShortUpdatedLabel(state.activeEdition);
    setRunningTask(false, `${s.feedsOnline || 18}/${s.feedsTotal || 18} live · ${updatedShort}`, 100);
    setTimeout(() => {
      const bar = document.getElementById("liveProgressBar");
      if (bar) bar.style.transform = "scaleX(0)";
    }, 600);
  } catch (err) {
    setRunningTask(false, "Sync needed — tap Sync", 0);
    document.getElementById("editionSubline").textContent = `Could not load edition (${err.message}).`;
  }
}

async function loadAuditLog() {
  try {
    const { data } = await fetchJsonWithFallback("./api/audit", "./data/audit-log.json");
    state.auditEntries = Array.isArray(data) ? data : data.entries || [];
  } catch {
    state.auditEntries = [];
  }
}

async function logAuditAction(action, department, detail) {
  const localEntry = {
    action,
    department,
    status: "OK",
    detail,
    timestampIst:
      new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }).format(new Date()) + " IST",
  };
  state.auditEntries.unshift(localEntry);
  renderAuditLog();
  if (state.serverMode === "local-live") {
    try {
      await fetch("./api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, department, detail, status: "OK" }),
      });
    } catch {
      // ignore
    }
  }
}

async function triggerLiveRefresh() {
  const btn = document.getElementById("refreshBtn");
  if (btn.classList.contains("loading")) return;
  btn.classList.add("loading");
  setRunningTask(true, "Syncing 18 feeds & extracting summaries…", 35);
  showToast("Fetching live 24h RBI, IRDAI & Banking feeds…");

  try {
    if (state.serverMode === "local-live") {
      const res = await fetch("./api/refresh", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRunningTask(true, "Finalizing crisp executive bullets…", 82);
      const fresh = await res.json();
      if (fresh.status === "already_running") {
        showToast("Sync already in progress");
        return;
      }
      state.latestEdition = fresh;
      state.activeEdition = fresh;
      state.isViewingArchive = false;
      const idxRes = await fetchJsonWithFallback("./api/editions", "./data/index.json");
      state.editionsIndex = idxRes.data.editions || [];
      await loadAuditLog();
      renderAll();
      setRunningTask(false, `${fresh.stats.feedsOnline}/${fresh.stats.feedsTotal} live · Synced just now`, 100);
      showToast(`Synced ${fresh.stats.totalItems} verified 24h items`);
    } else {
      await loadInitialData();
      const label = state.activeEdition?.editionLabel || "latest 8:00 PM edition";
      showToast(`Checked cloud · ${label}`);
    }
  } catch (err) {
    setRunningTask(false, "Sync failed — retry", 0);
    showToast(`Sync failed: ${err.message}`);
  } finally {
    btn.classList.remove("loading");
    setTimeout(() => {
      const bar = document.getElementById("liveProgressBar");
      if (bar) bar.style.transform = "scaleX(0)";
    }, 800);
  }
}

async function openArchivedEdition(dateKey) {
  try {
    const { data } = await fetchJsonWithFallback(
      `./api/edition/${dateKey}`,
      `./data/editions/${dateKey}.json`
    );
    state.activeEdition = data;
    state.isViewingArchive = state.latestEdition?.editionDate !== data.editionDate;
    state.selectedBank = "All";
    state.selectedInsuranceSub = "All";
    renderAll();
    switchTab("brief");
    showToast(`Opened ${dateKey} Edition`);
  } catch (err) {
    showToast(`Failed to open edition: ${err.message}`);
  }
}

// --- Command Centre Query (Local /api/ask + Static Client Fallback) ---
function runClientFallbackCommand(query) {
  const ed = state.activeEdition;
  const q = query.toLowerCase();
  const stop = new Set(["what", "which", "how", "the", "and", "for", "with", "today", "latest", "news", "bank", "banks", "draft", "whatsapp", "short", "brief", "team", "summarize"]);
  const words = q.replace(/[^a-z0-9\s₹%]/g, " ").split(/\s+/).filter((w) => w.length >= 2 && !stop.has(w));
  const all = (ed?.sections || []).flatMap((s) => s.items || []);
  const scored = all
    .map((it) => {
      const hay = `${it.headline} ${(it.keyPoints || []).join(" ")} ${it.branchImpact} ${it.source} ${(it.bankCategories || []).join(" ")}`.toLowerCase();
      let score = 0;
      for (const w of words) if (hay.includes(w)) score += 3;
      if (it.priority === "HIGH") score += 1;
      return { it, score };
    })
    .sort((a, b) => b.score - a.score);

  const top = scored.filter((x) => x.score > 1).slice(0, 4).map((x) => x.it);
  const picks = top.length ? top : all.slice(0, 3);
  const wantsDraft = /\b(draft|whatsapp|message|note|huddle)\b/i.test(q);
  const suggestedDraft = wantsDraft
    ? {
        id: `cmd_draft_${Date.now()}`,
        department: "Huddle & Communications Desk",
        channel: "WhatsApp / Team Brief",
        title: `Draft: ${picks[0]?.headline.slice(0, 56) || "Branch Update"}…`,
        reason: `Prepared from Command Centre prompt ("${query}") — waiting for your approval.`,
        body: [
          `*HDFC Bank Panchkula — Executive Desk Brief (${ed.editionDate})*`,
          ...picks.map((m, i) => `${i + 1}) *${m.headline}*\n   • ${m.keyPoints?.[0] || m.branchImpact}`),
        ].join("\n"),
      }
    : null;

  return {
    department: wantsDraft ? "Huddle & Communications Desk" : "Executive Banking Desk",
    pipeline: ["Understand", "Verified Facts", suggestedDraft ? "Draft Queued" : "Executive Answer"],
    summary: `Matched ${picks.length} verified last-24h updates from ${ed.editionDate}:`,
    answerBullets: picks.map((m) => `**${m.headline}** — ${m.keyPoints?.[0] || m.branchImpact}`),
    sources: picks.map((m) => ({ headline: m.headline, source: m.source, url: m.url })),
    suggestedDraft,
  };
}

async function submitCommandPrompt(rawQuery) {
  const query = rawQuery.trim();
  if (!query) return;
  const box = document.getElementById("commandResultBox");
  box.classList.remove("hidden");
  document.getElementById("commandPipeline").innerHTML = `<span class="pipe-step">Understand</span><span class="pipe-step">Routing department…</span>`;
  document.getElementById("commandSummary").textContent = "Checking verified last-24h RBI, pricing & banking intelligence…";
  document.getElementById("commandBullets").innerHTML = "";
  document.getElementById("commandDraftCta").classList.add("hidden");
  document.getElementById("commandSources").innerHTML = "";

  setRunningTask(true, `Routing: "${query.slice(0, 26)}…"`, 55);

  let data;
  try {
    if (state.serverMode === "local-live") {
      const res = await fetch("./api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
      await loadAuditLog();
      renderAuditLog();
    } else {
      data = runClientFallbackCommand(query);
    }
  } catch {
    data = runClientFallbackCommand(query);
  }

  document.getElementById("commandPipeline").innerHTML = (data.pipeline || [])
    .map((step) => `<span class="pipe-step">${esc(step)}</span>`)
    .join("");
  document.getElementById("commandSummary").textContent = data.summary || "";
  document.getElementById("commandBullets").innerHTML = (data.answerBullets || [])
    .map((b) => `<li>${formatInlineBold(b)}</li>`)
    .join("");

  const draftCta = document.getElementById("commandDraftCta");
  if (data.suggestedDraft) {
    state.customDrafts.unshift({
      ...data.suggestedDraft,
      editionDate: state.activeEdition?.editionDate || "",
      createdAtMs: Date.now(),
    });
    state.customDrafts = state.customDrafts.slice(0, 10);
    saveJson(CUSTOM_DRAFTS_KEY, state.customDrafts);
    renderApprovals();
    renderAttentionCard();

    draftCta.classList.remove("hidden");
    draftCta.innerHTML = `
      <span><strong>Approval Required:</strong> Draft queued before sharing.</span>
      <button type="button" class="btn-chip-accent" id="jumpToApprovalBtn">Review Draft →</button>
    `;
    document.getElementById("jumpToApprovalBtn").addEventListener("click", () => switchTab("approvals"));
  } else {
    draftCta.classList.add("hidden");
  }

  document.getElementById("commandSources").innerHTML = (data.sources || [])
    .map((s) => `<a class="source-pill-link" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.source)} ↗</a>`)
    .join("");

  const st = state.activeEdition?.stats || {};
  setRunningTask(false, `${st.feedsOnline || 18}/${st.feedsTotal || 18} live · ${formatShortUpdatedLabel(state.activeEdition)}`, 100);
  setTimeout(() => {
    const bar = document.getElementById("liveProgressBar");
    if (bar) bar.style.transform = "scaleX(0)";
  }, 500);
}

// --- Combined Approvals Queue (Auto-Refreshes With Every New Edition / Content Hash) ---
function pruneStaleCustomDrafts() {
  const activeDate = state.activeEdition?.editionDate;
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  const before = state.customDrafts.length;
  state.customDrafts = state.customDrafts.filter((d) => {
    if (d.createdAtMs && d.createdAtMs < cutoffMs) return false;
    if (activeDate && d.editionDate && d.editionDate !== activeDate) return false;
    return true;
  });
  if (state.customDrafts.length !== before) {
    saveJson(CUSTOM_DRAFTS_KEY, state.customDrafts);
  }
}

function getActiveDrafts() {
  pruneStaleCustomDrafts();
  const edDrafts = state.activeEdition?.pendingDrafts || [];
  const combined = [...state.customDrafts, ...edDrafts];
  const seen = new Set();
  return combined.filter((d) => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return state.approvalStatus[d.id] !== "dismissed";
  });
}

function getPendingApprovalsCount() {
  return getActiveDrafts().filter((d) => state.approvalStatus[d.id] !== "approved").length;
}

// --- Rendering ---
function renderAll() {
  const ed = state.activeEdition;
  if (!ed) return;

  updateDynamicGreeting();

  // Archive banner
  const banner = document.getElementById("archiveBanner");
  if (state.isViewingArchive) {
    banner.classList.remove("hidden");
    document.getElementById("archiveBannerText").textContent = `Archive: ${ed.editionDate} (${ed.stats?.totalItems || 0} items)`;
  } else {
    banner.classList.add("hidden");
  }

  // Hero Bento telemetry cells
  document.getElementById("heroEditionPill").textContent = `${ed.editionDate} · 8:00 PM DESK`;
  document.getElementById("heroReadPill").textContent = `~${ed.stats?.estimatedReadMinutes || 4} min`;
  document.getElementById("heroSourcesPill").textContent =
    `${ed.stats?.feedsOnline || 18}/${ed.stats?.feedsTotal || 18} LIVE`;
  const signalsEl = document.getElementById("heroSignalsVal");
  if (signalsEl) signalsEl.textContent = `${ed.stats?.totalItems || 0} kept`;
  const noiseEl = document.getElementById("heroNoiseVal");
  if (noiseEl) noiseEl.textContent = `${ed.stats?.suppressedCount || 0} cut`;

  document.getElementById("editionSubline").textContent =
    `Synced ${ed.editionLabel} · ${ed.stats?.feedsOnline || 0}/${ed.stats?.feedsTotal || 0} official & Tier-1 feeds live`;

  const edStatsEl = document.getElementById("editorAgentStats");
  if (edStatsEl) {
    const kept = ed.stats?.totalItems || 0;
    const cut = ed.stats?.suppressedCount || 0;
    const savedMin = ed.editorAgent?.timeSavedMinutes || Math.max(2, Math.round(cut * 0.65));
    edStatsEl.textContent = `${kept} crisp signals kept · ${cut} basic/routine items cut (~${savedMin} min saved)`;
  }

  renderAttentionCard();
  renderTopFive();
  renderBankFilters();
  renderSectionJumpBar();
  renderSections();
  renderSuppressedDrawer();
  renderApprovals();
  renderBookmarks();
  renderArchiveList();
  renderAuditLog();
  renderDeskStatus();
}

function renderAttentionCard() {
  const ed = state.activeEdition;
  if (!ed) return;
  const rbiCount = ed.sections?.find((s) => s.id === "rbi_regulatory")?.items?.length || 0;
  const ratesCount = ed.sections?.find((s) => s.id === "interest_rates")?.items?.length || 0;
  const hdfcCount = countByBank(ed, "HDFC");
  const pendingDrafts = getPendingApprovalsCount();

  const rows = [
    {
      count: pendingDrafts,
      title: pendingDrafts === 1 ? "Team briefing waiting for approval" : "Team briefings waiting for approval",
      sub: "9:30 AM Panchkula Huddle & Desk WhatsApp drafts",
      tone: "",
      onClick: () => switchTab("approvals"),
    },
    {
      count: rbiCount,
      title: "RBI & Regulatory alerts to review",
      sub: "Compliance, KYC, ATM/POS & Card Directions",
      tone: "tone-crimson",
      onClick: () => {
        state.selectedBank = "All";
        renderBankFilters();
        renderSections();
        switchTab("brief");
        setTimeout(() => scrollToSectionWithOffset("rbi_regulatory"), 70);
      },
    },
    {
      count: hdfcCount,
      title: "HDFC Bank direct updates",
      sub: "UPI SMS rule, Senior Citizen FD vs SCSS & policy watch",
      tone: "tone-cyan",
      onClick: () => {
        state.selectedBank = "HDFC";
        renderBankFilters();
        renderSections();
        switchTab("brief");
      },
    },
    {
      count: ratesCount,
      title: "Interest rate & pricing moves",
      sub: "MCLR, Repo outlook, SCSS, FD & Global Central Banks",
      tone: "tone-emerald",
      onClick: () => {
        state.selectedBank = "All";
        renderBankFilters();
        renderSections();
        switchTab("brief");
        setTimeout(() => scrollToSectionWithOffset("interest_rates"), 70);
      },
    },
  ];

  const container = document.getElementById("attentionRows");
  container.innerHTML = rows
    .map(
      (r, idx) => `
      <button type="button" class="attention-row ${r.tone}" data-att-idx="${idx}">
        <div class="attention-row-top">
          <span class="attention-count">${r.count}</span>
          <span class="attention-arrow" aria-hidden="true">↗</span>
        </div>
        <div class="attention-body">
          <div class="attention-title">${esc(r.title)}</div>
          <div class="attention-sub">${esc(r.sub)}</div>
        </div>
      </button>`
    )
    .join("");

  container.querySelectorAll("[data-att-idx]").forEach((btn) => {
    btn.addEventListener("click", () => rows[Number(btn.dataset.attIdx)].onClick());
  });

  // Update Approvals nav badge
  const navBadge = document.getElementById("approvalsNavBadge");
  if (pendingDrafts > 0) {
    navBadge.textContent = String(pendingDrafts);
    navBadge.classList.remove("hidden");
  } else {
    navBadge.classList.add("hidden");
  }
}

function renderTopFive() {
  const list = document.getElementById("topFiveList");
  const topFive = state.activeEdition?.topFive || [];
  if (topFive.length === 0) {
    list.innerHTML = `<li>No major verified developments in the last 24 hours.</li>`;
    return;
  }
  list.innerHTML = topFive
    .map(
      (item, idx) => `
      <li>
        <span class="pulse-idx" aria-hidden="true">${String(idx + 1).padStart(2, "0")}</span>
        <div class="pulse-content">
          <a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.text)}</a>
          <div class="pulse-meta-line">
            ${item.effectiveTag ? `<span class="tag tag-effective">${esc(item.effectiveTag)}</span>` : ""}
            <span class="pulse-source">${esc(item.source)}</span>
          </div>
          ${item.takeaway ? `<div class="pulse-takeaway">${esc(item.takeaway)}</div>` : ""}
        </div>
      </li>`
    )
    .join("");
}

function countByBank(ed, bank) {
  const allItems = (ed.sections || []).flatMap((s) => s.items || []);
  if (bank === "All") return allItems.length;
  return allItems.filter((i) => (i.bankCategories || []).includes(bank)).length;
}

function updateStickyActiveBadge() {
  const badge = document.getElementById("stickyActiveBadge");
  const dock = document.getElementById("briefFilterDock");
  if (!badge || !dock) return;
  if (dock.classList.contains("is-stuck")) {
    const count = state.activeEdition ? countByBank(state.activeEdition, state.selectedBank) : 0;
    badge.textContent = `${state.selectedBank.toUpperCase()} (${count})`;
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

function getStickyOffsetPx() {
  const topbar = document.querySelector(".topbar");
  const wrap = document.getElementById("briefStickyWrap") || document.getElementById("briefFilterDock");
  const topbarH = topbar ? Math.round(topbar.getBoundingClientRect().height) : 63;
  const dockH = wrap ? Math.round(wrap.getBoundingClientRect().height) : 118;
  return { topbarH, dockH, total: topbarH + dockH };
}

function scrollToSectionWithOffset(sectionId) {
  const target = document.getElementById(`sec-${sectionId}`);
  if (!target) return;
  const { total } = getStickyOffsetPx();
  const y = window.scrollY + target.getBoundingClientRect().top - total - 12;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: Math.max(0, y), behavior: reduced ? "auto" : "smooth" });
  setActiveJumpPill(sectionId);
}

function setActiveJumpPill(sectionId) {
  const bar = document.getElementById("sectionJumpBar");
  if (!bar) return;
  bar.querySelectorAll(".jump-pill").forEach((pill) => {
    const isMatch = pill.dataset.secId === sectionId;
    pill.classList.toggle("active", isMatch);
    if (isMatch) {
      pill.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  });
}

function renderBankFilters() {
  const ed = state.activeEdition;
  const bar = document.getElementById("bankFilterBar");
  bar.innerHTML = BANK_FILTERS.map((bank) => {
    const count = countByBank(ed, bank);
    const active = state.selectedBank === bank;
    return `<button type="button" role="tab" aria-selected="${active}" class="chip ${active ? "active" : ""}" data-bank="${esc(bank)}">${esc(bank)} <span class="chip-count">${count}</span></button>`;
  }).join("");

  bar.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedBank = btn.dataset.bank;
      renderBankFilters();
      renderSections();
      updateStickyActiveBadge();
      // If user switches segment while scrolled down inside news, jump cleanly to top of filtered news below sticky dock
      const dock = document.getElementById("briefFilterDock");
      const sectionsEl = document.getElementById("sectionsContainer");
      if (dock?.classList.contains("is-stuck") && sectionsEl) {
        const { total } = getStickyOffsetPx();
        const topY = window.scrollY + sectionsEl.getBoundingClientRect().top - total - 12;
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: Math.max(0, topY), behavior: reduced ? "auto" : "smooth" });
      }
    });
  });

  updateStickyActiveBadge();
}

function renderSectionJumpBar() {
  const bar = document.getElementById("sectionJumpBar");
  bar.innerHTML = (state.activeEdition?.sections || [])
    .map(
      (sec, idx) =>
        `<a class="jump-pill ${idx === 0 ? "active" : ""}" data-sec-id="${esc(sec.id)}" href="#sec-${esc(sec.id)}">${esc(sec.shortTitle)} (${sec.items.length})</a>`
    )
    .join("");

  bar.querySelectorAll(".jump-pill").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      scrollToSectionWithOffset(link.dataset.secId);
    });
  });
}

function isBookmarked(url) {
  return state.bookmarks.some((b) => b.url === url);
}

function toggleBookmark(item, editionDate) {
  const idx = state.bookmarks.findIndex((b) => b.url === item.url);
  if (idx >= 0) {
    state.bookmarks.splice(idx, 1);
    showToast("Removed from Bookmarks");
  } else {
    state.bookmarks.unshift({
      headline: item.headline,
      source: item.source,
      url: item.url,
      keyPoints: item.keyPoints || [],
      branchImpact: item.branchImpact,
      publishedIst: item.publishedIst,
      editionDate,
    });
    showToast("Saved to Bookmarks");
  }
  saveJson(BOOKMARK_KEY, state.bookmarks);
  renderSections();
  renderBookmarks();
}

function renderItemCard(item, editionDate, extraMeta = "") {
  const prioClass = item.priority === "HIGH" ? "prio-high" : item.priority === "MEDIUM" ? "prio-medium" : "";
  const saved = isBookmarked(item.url);

  const bankTagsHtml = (item.bankCategories || [])
    .map((b) => `<span class="tag ${b === "HDFC" ? "tag-hdfc" : "tag-bank"}">${esc(b)}</span>`)
    .join("");

  const insTag = item.insuranceType ? `<span class="tag tag-ins">${esc(item.insuranceType)}</span>` : "";
  const highTag = item.priority === "HIGH" ? `<span class="tag tag-high">HIGH PRIORITY</span>` : "";
  const effTag = item.effectiveTag ? `<span class="tag tag-effective">${esc(item.effectiveTag)}</span>` : "";

  const points =
    Array.isArray(item.keyPoints) && item.keyPoints.length > 0
      ? item.keyPoints
      : item.summary
        ? [item.summary]
        : [];

  const summaryHtml =
    points.length > 0
      ? `<ul class="key-points">${points.map((pt) => `<li>${esc(pt)}</li>`).join("")}</ul>`
      : "";

  return `
    <article class="intel-card ${prioClass}">
      <div class="card-tags">
        ${highTag}
        ${effTag}
        ${insTag}
        ${bankTagsHtml}
        ${extraMeta ? `<span class="tag tag-bank">${esc(extraMeta)}</span>` : ""}
      </div>
      <h4 class="card-headline">
        <a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.headline)}</a>
      </h4>
      ${summaryHtml}
      <div class="impact-box">
        <strong>BM Action:</strong> ${esc(item.branchImpact)}
      </div>
      <div class="card-footer">
        <div class="source-meta">
          <span class="verified-dot" title="Verified Trusted Source"></span>
          <span><strong>${esc(item.source)}</strong> · ${esc(item.publishedIst || "")}</span>
        </div>
        <div class="card-actions">
          <button class="bookmark-btn ${saved ? "saved" : ""}" data-bm-url="${esc(item.url)}" data-bm-date="${esc(editionDate)}">
            ${saved ? "★ Saved" : "☆ Save"}
          </button>
          <a class="action-link" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Source ↗</a>
        </div>
      </div>
    </article>`;
}

function renderSections() {
  const ed = state.activeEdition;
  const container = document.getElementById("sectionsContainer");
  const allItemsByUrl = new Map();

  container.innerHTML = (ed.sections || [])
    .map((sec) => {
      let filtered = sec.items || [];
      if (state.selectedBank !== "All") {
        filtered = filtered.filter((i) => (i.bankCategories || []).includes(state.selectedBank));
      }
      if (sec.id === "insurance" && state.selectedInsuranceSub !== "All") {
        filtered = filtered.filter((i) => i.insuranceType === state.selectedInsuranceSub);
      }

      filtered.forEach((it) => allItemsByUrl.set(it.url, it));

      const subfilterHtml =
        sec.id === "insurance"
          ? `<div class="subfilter-row">
              ${INSURANCE_FILTERS.map(
                (sub) =>
                  `<button class="subchip ${state.selectedInsuranceSub === sub ? "active" : ""}" data-ins="${esc(sub)}">${esc(sub)}</button>`
              ).join("")}
            </div>`
          : "";

      const filterActive = state.selectedBank !== "All" || (sec.id === "insurance" && state.selectedInsuranceSub !== "All");
      const bodyHtml =
        filtered.length > 0
          ? `<div class="cards-stack">${filtered.map((it) => renderItemCard(it, ed.editionDate)).join("")}</div>`
          : `<div class="empty-notice">
              <span>${
                filterActive
                  ? `No updates in ${esc(sec.shortTitle)} matching the active filter in the last 24 hours.`
                  : esc(sec.emptyNotice || "No major verified update published in the last 24 hours.")
              }</span>
              ${filterActive ? `<button type="button" class="btn-secondary-sm" data-reset-filters="1">Show All Segments</button>` : ""}
            </div>`;

      return `
        <section class="intel-section" id="sec-${esc(sec.id)}">
          <div class="section-header">
            <div>
              <div class="section-badge">${esc(sec.badge)}</div>
              <h3>${esc(sec.title)}</h3>
            </div>
            <span class="section-count">${filtered.length} item${filtered.length === 1 ? "" : "s"}</span>
          </div>
          ${subfilterHtml}
          ${bodyHtml}
        </section>`;
    })
    .join("");

  container.querySelectorAll(".subchip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedInsuranceSub = btn.dataset.ins;
      renderSections();
    });
  });

  container.querySelectorAll(".bookmark-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = allItemsByUrl.get(btn.dataset.bmUrl);
      if (item) toggleBookmark(item, btn.dataset.bmDate);
    });
  });

  container.querySelectorAll("[data-reset-filters]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedBank = "All";
      state.selectedInsuranceSub = "All";
      renderBankFilters();
      renderSections();
    });
  });

  initSectionScrollSpy();
}

function renderSuppressedDrawer() {
  const drawer = document.getElementById("suppressedDrawer");
  const summary = document.getElementById("suppressedSummary");
  const list = document.getElementById("suppressedList");
  const items = state.activeEdition?.suppressedItems || [];

  if (!drawer || items.length === 0) {
    drawer?.classList.add("hidden");
    return;
  }

  drawer.classList.remove("hidden");
  summary.textContent = `Filtered Out by Editor Agent (${items.length} basic/routine items you already know)`;
  list.innerHTML = items
    .map(
      (it) => `
      <div class="suppressed-row">
        <div><a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">${esc(it.headline)}</a></div>
        <div class="suppressed-reason">${esc(it.sectionTitle || "")} · ${esc(it.source)} · ${esc(it.suppressedReason || "Routine item")}</div>
      </div>`
    )
    .join("");
}

function renderApprovals() {
  const container = document.getElementById("approvalsList");
  const drafts = getActiveDrafts();
  const stampEl = document.getElementById("approvalsUpdatedStamp");
  if (stampEl && state.activeEdition) {
    const pendingCount = drafts.filter((d) => state.approvalStatus[d.id] !== "approved").length;
    stampEl.textContent = `SYNCED ${formatShortUpdatedLabel(state.activeEdition)} · ${pendingCount} PENDING`;
  }

  if (drafts.length === 0) {
    container.innerHTML = `<div class="empty-notice">
      <span>All team &amp; huddle briefings reviewed! Need a new WhatsApp update?</span>
      <button type="button" class="btn-secondary-sm" id="emptyGoCommandBtn">Draft in Command Centre</button>
    </div>`;
    document.getElementById("emptyGoCommandBtn")?.addEventListener("click", () => switchTab("command"));
    return;
  }

  container.innerHTML = drafts
    .map((d) => {
      const approved = state.approvalStatus[d.id] === "approved";
      return `
        <article class="bento-card approval-card ${approved ? "is-approved" : ""}" data-draft-id="${esc(d.id)}">
          <div class="approval-top">
            <span class="approval-dept">${esc(d.department)} · ${esc(d.channel)}</span>
            <span class="approval-status ${approved ? "approved" : ""}">${approved ? "✓ Approved" : "Waiting Approval"}</span>
          </div>
          <h3 class="approval-title">${esc(d.title)}</h3>
          <p class="approval-reason">${esc(d.reason)}</p>
          <textarea class="approval-textarea" data-draft-text="${esc(d.id)}" aria-label="${esc(d.title)} draft text">${esc(d.body)}</textarea>
          <div class="approval-actions">
            <button type="button" class="btn-approve" data-approve="${esc(d.id)}">
              ${approved ? "✓ Copy Approved Brief" : "✓ Approve & Copy for WhatsApp"}
            </button>
            <button type="button" class="btn-secondary-sm" data-share="${esc(d.id)}">Share</button>
            <button type="button" class="btn-danger-soft" data-dismiss="${esc(d.id)}">Dismiss</button>
          </div>
        </article>`;
    })
    .join("");

  const copyText = async (txt) => {
    try {
      await navigator.clipboard.writeText(txt);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = txt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
  };

  container.querySelectorAll("[data-approve]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.approve;
      const draft = drafts.find((x) => x.id === id);
      const ta = container.querySelector(`[data-draft-text="${CSS.escape(id)}"]`);
      const finalBody = ta ? ta.value : draft?.body || "";
      await copyText(finalBody);
      state.approvalStatus[id] = "approved";
      saveJson(APPROVAL_STATE_KEY, state.approvalStatus);
      renderApprovals();
      renderAttentionCard();
      showToast("Approved & copied for WhatsApp!");
      logAuditAction("DRAFT_APPROVED", draft?.department || "Branch Leadership", `Approved & copied "${draft?.title || id}".`);
    });
  });

  container.querySelectorAll("[data-share]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.share;
      const draft = drafts.find((x) => x.id === id);
      const ta = container.querySelector(`[data-draft-text="${CSS.escape(id)}"]`);
      const finalBody = ta ? ta.value : draft?.body || "";
      if (navigator.share) {
        try {
          await navigator.share({ title: draft?.title || "BM Intel Brief", text: finalBody });
          state.approvalStatus[id] = "approved";
          saveJson(APPROVAL_STATE_KEY, state.approvalStatus);
          renderApprovals();
          renderAttentionCard();
          logAuditAction("DRAFT_SHARED", draft?.department || "Branch Leadership", `Shared "${draft?.title || id}" via mobile share sheet.`);
          return;
        } catch {
          // user cancelled or fallback
        }
      }
      await copyText(finalBody);
      showToast("Copied to clipboard for sharing");
    });
  });

  container.querySelectorAll("[data-dismiss]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.dismiss;
      const draft = drafts.find((x) => x.id === id);
      state.approvalStatus[id] = "dismissed";
      saveJson(APPROVAL_STATE_KEY, state.approvalStatus);
      renderApprovals();
      renderAttentionCard();
      showToast("Draft dismissed");
      logAuditAction("DRAFT_DISMISSED", draft?.department || "Branch Leadership", `Dismissed draft "${draft?.title || id}".`);
    });
  });
}

function renderBookmarks() {
  const list = document.getElementById("bookmarksList");
  const count = document.getElementById("bookmarkCount");
  const clearBtn = document.getElementById("clearBookmarksBtn");

  count.textContent = String(state.bookmarks.length);
  clearBtn.classList.toggle("hidden", state.bookmarks.length === 0);

  if (state.bookmarks.length === 0) {
    list.innerHTML = `<div class="empty-notice">
      <span>Tap <strong>☆ Save</strong> on any circular, rate change, or insurance update to pin it here.</span>
      <button type="button" class="btn-secondary-sm" id="emptyGoBriefBtn">Browse Today's Brief</button>
    </div>`;
    document.getElementById("emptyGoBriefBtn")?.addEventListener("click", () => switchTab("brief"));
    return;
  }

  list.innerHTML = state.bookmarks
    .map(
      (b) => `
      <div class="intel-card">
        <h4 class="card-headline">
          <a href="${esc(b.url)}" target="_blank" rel="noopener noreferrer">${esc(b.headline)}</a>
        </h4>
        ${b.keyPoints?.length ? `<ul class="key-points"><li>${esc(b.keyPoints[0])}</li></ul>` : ""}
        <div class="impact-box"><strong>Branch Angle:</strong> ${esc(b.branchImpact || "")}</div>
        <div class="card-footer">
          <span><strong>${esc(b.source)}</strong> · ${esc(b.editionDate || "")}</span>
          <button class="bookmark-btn saved" data-rm-bm="${esc(b.url)}">Remove</button>
        </div>
      </div>`
    )
    .join("");

  list.querySelectorAll("[data-rm-bm]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.bookmarks = state.bookmarks.filter((x) => x.url !== btn.dataset.rmBm);
      saveJson(BOOKMARK_KEY, state.bookmarks);
      renderBookmarks();
      renderSections();
      showToast("Bookmark removed");
    });
  });
}

function renderArchiveList() {
  const list = document.getElementById("editionsList");
  if (!state.editionsIndex || state.editionsIndex.length === 0) {
    list.innerHTML = `<div class="empty-notice">Daily 8:00 PM editions accumulate here automatically.</div>`;
    return;
  }
  list.innerHTML = state.editionsIndex
    .map(
      (ed) => `
      <button type="button" class="edition-row" data-open-date="${esc(ed.editionDate)}">
        <div>
          <div class="edition-row-date">${esc(ed.editionDate)} · ${ed.totalItems} verified items (~${ed.estimatedReadMinutes} min)</div>
          <div class="edition-row-sub">${esc(ed.topHeadline)}</div>
        </div>
        <span class="btn-secondary-sm" aria-hidden="true">Open</span>
      </button>`
    )
    .join("");

  list.querySelectorAll("[data-open-date]").forEach((row) => {
    row.addEventListener("click", () => openArchivedEdition(row.dataset.openDate));
  });
}

function renderAuditLog() {
  const el = document.getElementById("auditLogList");
  if (!el) return;
  if (!state.auditEntries || state.auditEntries.length === 0) {
    el.innerHTML = `<div class="empty-notice">Every 8:00 PM sync, Command Centre query, and draft approval is logged here.</div>`;
    return;
  }
  el.innerHTML = state.auditEntries
    .slice(0, 12)
    .map(
      (a) => `
      <div class="audit-row">
        <div class="audit-row-top">
          <span class="audit-action">${esc(a.action)} · ${esc(a.department || "")}</span>
          <span class="audit-time">${esc(a.timestampIst || "")}</span>
        </div>
        <div class="audit-detail">${esc(a.detail)}</div>
      </div>`
    )
    .join("");
}

function renderDeskStatus() {
  const ed = state.activeEdition;
  if (!ed) return;
  document.getElementById("feedsOnlineStat").textContent = `${ed.stats?.feedsOnline || 0} / ${ed.stats?.feedsTotal || 0}`;
  document.getElementById("synthesisModeStat").textContent = ed.synthesisMode || "Deep Article Engine";

  const srcList = document.getElementById("sourceHealthList");
  srcList.innerHTML = (ed.sourceHealth || [])
    .map(
      (s) => `
      <div class="source-row">
        <div>
          <div class="source-name">${esc(s.name)}</div>
          <div class="source-tier">${esc(s.tier)} · ${s.fetched} raw / <strong>${s.verified24h}</strong> verified 24h (${s.ms}ms)</div>
        </div>
        <span class="source-badge ${s.status === "OK" ? "ok" : "err"}">${esc(s.status)}</span>
      </div>`
    )
    .join("");
}

// --- Search ---
async function performSearch(query) {
  const q = query.trim();
  const wrap = document.getElementById("searchResultsWrap");
  const clearBtn = document.getElementById("searchClearBtn");
  clearBtn.classList.toggle("hidden", !q);

  if (!q) {
    wrap.classList.add("hidden");
    return;
  }
  wrap.classList.remove("hidden");
  document.getElementById("searchMeta").textContent = `Searching archive for "${q}"…`;

  let results = [];
  if (state.serverMode === "local-live") {
    try {
      const res = await fetch(`./api/search?q=${encodeURIComponent(q)}`);
      if (res.ok) results = (await res.json()).results || [];
    } catch {
      results = [];
    }
  } else {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const datesToScan = (state.editionsIndex || []).slice(0, 14).map((e) => e.editionDate);
    const fetchedEditions = await Promise.all(
      datesToScan.map(async (dateKey) => {
        try {
          const res = await fetch(`./data/editions/${dateKey}.json?t=${Date.now()}`, { cache: "no-store" });
          return res.ok ? await res.json() : null;
        } catch {
          return null;
        }
      })
    );
    for (const ed of fetchedEditions) {
      if (!ed) continue;
      for (const sec of ed.sections || []) {
        for (const item of sec.items || []) {
          const hay = `${item.headline} ${item.summary} ${(item.keyPoints || []).join(" ")} ${item.branchImpact} ${item.source} ${item.insuranceType || ""} ${(item.bankCategories || []).join(" ")}`.toLowerCase();
          if (terms.every((t) => hay.includes(t))) {
            results.push({ ...item, sectionTitle: sec.shortTitle, editionDate: ed.editionDate });
          }
        }
      }
    }
  }

  document.getElementById("searchMeta").textContent = `${results.length} matching update${results.length === 1 ? "" : "s"} for "${q}"`;
  const listEl = document.getElementById("searchResultsList");
  if (results.length === 0) {
    listEl.innerHTML = `<div class="empty-notice">
      <span>No matching items found across saved editions.</span>
      <button type="button" class="btn-secondary-sm" id="emptyClearSearchBtn">Clear Search</button>
    </div>`;
    document.getElementById("emptyClearSearchBtn")?.addEventListener("click", () => {
      document.getElementById("searchInput").value = "";
      performSearch("");
    });
    return;
  }

  const mapByUrl = new Map(results.map((r) => [r.url, r]));
  listEl.innerHTML = results
    .map((item) => renderItemCard(item, item.editionDate, `${item.editionDate} · ${item.sectionTitle}`))
    .join("");

  listEl.querySelectorAll(".bookmark-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = mapByUrl.get(btn.dataset.bmUrl);
      if (item) toggleBookmark(item, btn.dataset.bmDate);
    });
  });
}

// --- 8:00 PM IST Countdown ---
function updateCountdown() {
  const now = new Date();
  const istNowMs = now.getTime() + 330 * 60 * 1000;
  const istDate = new Date(istNowMs);
  const target = new Date(istDate);
  target.setUTCHours(20, 0, 0, 0);
  if (istDate.getTime() >= target.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  const diffSec = Math.max(0, Math.floor((target.getTime() - istDate.getTime()) / 1000));
  const hrs = String(Math.floor(diffSec / 3600)).padStart(2, "0");
  const mins = String(Math.floor((diffSec % 3600) / 60)).padStart(2, "0");
  const secs = String(diffSec % 60).padStart(2, "0");
  const el = document.getElementById("countdownClock");
  if (el) el.textContent = `${hrs}h ${mins}m ${secs}s`;
}

// --- Sticky Brief Filter Dock & Section Scroll-Spy (IntersectionObserver — Zero Scroll Jank) ---
let stickyObserver = null;
let sectionSpyObserver = null;

function syncStickyOffsets() {
  const { topbarH, total } = getStickyOffsetPx();
  document.documentElement.style.setProperty("--topbar-h", `${topbarH}px`);
  document.documentElement.style.setProperty("--sticky-offset", `${total}px`);

  const sentinel = document.getElementById("briefFilterSentinel");
  const dock = document.getElementById("briefFilterDock");
  if (!sentinel || !dock) return;

  if (stickyObserver) stickyObserver.disconnect();
  stickyObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      const briefActive = document.getElementById("tab-brief")?.classList.contains("active");
      const stuck = Boolean(briefActive && !entry.isIntersecting && entry.boundingClientRect.top < topbarH + 2);
      dock.classList.toggle("is-stuck", stuck);
      updateStickyActiveBadge();
    },
    {
      root: null,
      rootMargin: `-${topbarH}px 0px 0px 0px`,
      threshold: 0,
    }
  );
  stickyObserver.observe(sentinel);
}

function initSectionScrollSpy() {
  if (sectionSpyObserver) sectionSpyObserver.disconnect();
  const sections = document.querySelectorAll("#sectionsContainer .intel-section");
  if (!sections.length) return;
  const { total } = getStickyOffsetPx();

  sectionSpyObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length > 0) {
        const secId = visible[0].target.id.replace(/^sec-/, "");
        setActiveJumpPill(secId);
      }
    },
    {
      root: null,
      rootMargin: `-${total + 16}px 0px -55% 0px`,
      threshold: 0,
    }
  );

  sections.forEach((sec) => sectionSpyObserver.observe(sec));
}

// --- Navigation, Theme, Layout & PIN ---
function switchTab(tabId) {
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  document.querySelectorAll(".dock-btn").forEach((n) => {
    n.classList.remove("active");
    n.removeAttribute("aria-current");
  });
  document.getElementById(`tab-${tabId}`)?.classList.add("active");
  const activeBtn = document.querySelector(`.dock-btn[data-tab="${tabId}"]`);
  if (activeBtn) {
    activeBtn.classList.add("active");
    activeBtn.setAttribute("aria-current", "page");
  }
  const dock = document.getElementById("briefFilterDock");
  if (dock) {
    dock.classList.remove("is-stuck");
    updateStickyActiveBadge();
  }
  window.scrollTo({ top: 0 });
  if (tabId === "brief") {
    requestAnimationFrame(() => {
      syncStickyOffsets();
      initSectionScrollSpy();
    });
  }
}

function applyThemeColorMeta(theme) {
  const meta = document.getElementById("metaThemeColor");
  if (meta) meta.setAttribute("content", theme === "dark" ? "#141210" : "#FFF5E6");
}

function initThemeAndLayout() {
  // Default to TypeUI Bento Warm Light theme (#FFF5E6 surface, #FAD4C0 primary, #80A1C1 secondary)
  const savedTheme = localStorage.getItem(THEME_KEY) || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
  applyThemeColorMeta(savedTheme);
  document.getElementById("themeIcon").textContent = savedTheme === "dark" ? "☀" : "☾";

  const savedLayout = localStorage.getItem(LAYOUT_KEY) || "phone";
  const shell = document.getElementById("appShell");
  if (savedLayout === "wide") {
    shell.classList.remove("phone-frame");
    shell.classList.add("wide-frame");
  }

  document.getElementById("themeToggleBtn").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(THEME_KEY, next);
    applyThemeColorMeta(next);
    document.getElementById("themeIcon").textContent = next === "dark" ? "☀" : "☾";
  });

  document.getElementById("layoutToggleBtn").addEventListener("click", () => {
    const isPhone = shell.classList.contains("phone-frame");
    shell.classList.toggle("phone-frame", !isPhone);
    shell.classList.toggle("wide-frame", isPhone);
    localStorage.setItem(LAYOUT_KEY, isPhone ? "wide" : "phone");
    requestAnimationFrame(() => syncStickyOffsets());
  });
}

function initEvents() {
  document.querySelectorAll(".dock-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  document.getElementById("openFullBriefBtn").addEventListener("click", () => switchTab("brief"));
  document.getElementById("refreshBtn").addEventListener("click", triggerLiveRefresh);

  document.getElementById("returnLatestBtn").addEventListener("click", () => {
    if (state.latestEdition) {
      state.activeEdition = state.latestEdition;
      state.isViewingArchive = false;
      renderAll();
    }
  });

  // Command Centre submit & presets
  document.getElementById("commandForm").addEventListener("submit", (e) => {
    e.preventDefault();
    submitCommandPrompt(document.getElementById("commandInput").value);
  });

  document.querySelectorAll("#commandPresets .prompt-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.getElementById("commandInput").value = chip.dataset.prompt;
      submitCommandPrompt(chip.dataset.prompt);
    });
  });

  document.getElementById("clearBookmarksBtn").addEventListener("click", () => {
    state.bookmarks = [];
    saveJson(BOOKMARK_KEY, state.bookmarks);
    renderBookmarks();
    renderSections();
    showToast("All bookmarks cleared");
  });

  // Archive search
  const searchInput = document.getElementById("searchInput");
  let debounceTimer;
  searchInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => performSearch(searchInput.value), 220);
  });

  document.getElementById("searchClearBtn").addEventListener("click", () => {
    searchInput.value = "";
    performSearch("");
  });

  document.querySelectorAll("#quickSearchChips .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      searchInput.value = chip.dataset.q;
      performSearch(chip.dataset.q);
    });
  });
}

if ("serviceWorker" in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloadedForSw = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !reloadedForSw) {
      reloadedForSw = true;
      window.location.reload();
    }
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .then((reg) => reg.update())
      .catch(() => {});
  });
}

// Auto-refresh when returning to the installed phone app after 10+ minutes
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - lastCloudLoadMs > 10 * 60 * 1000) {
    loadInitialData();
  }
});

// Boot
initThemeAndLayout();
initEvents();
syncStickyOffsets();
window.addEventListener("resize", () => syncStickyOffsets(), { passive: true });
updateCountdown();
setInterval(updateCountdown, 1000);
loadInitialData();
