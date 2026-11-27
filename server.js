import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { runIntelFetch, appendAuditEntry } from "./scripts/fetch-intel.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(PUBLIC_DIR, "data");
const EDITIONS_DIR = path.join(DATA_DIR, "editions");

const PORT = Number(process.env.PORT || 8080);
const SCHEDULE_HOUR_IST = Number(process.env.SCHEDULE_HOUR_IST ?? 20);
const SCHEDULE_MINUTE_IST = Number(process.env.SCHEDULE_MINUTE_IST ?? 0);

let isRefreshing = false;
let lastScheduledRunDate = null;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function getIstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    dateKey: `${map.year}-${map.month}-${map.day}`,
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function getLocalLanUrls() {
  const nets = os.networkInterfaces();
  const urls = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        urls.push(`http://${net.address}:${PORT}`);
      }
    }
  }
  return urls;
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 100_000) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

// Mtime-aware in-memory JSON cache (drops /api/latest & /api/ask latency to ~1-3ms while auto-invalidating on sync)
const jsonCache = new Map();

function readJsonCached(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const stat = fs.statSync(filePath);
    const cached = jsonCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      return cached.data;
    }
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    jsonCache.set(filePath, { mtimeMs: stat.mtimeMs, data });
    return data;
  } catch {
    return null;
  }
}

function readLatestEditionSafe() {
  return readJsonCached(path.join(DATA_DIR, "latest.json"));
}

function searchAllEditions(query) {
  const q = query.trim().toLowerCase();
  if (!q || !fs.existsSync(EDITIONS_DIR)) return [];
  const terms = q.split(/\s+/).filter(Boolean);

  const files = fs
    .readdirSync(EDITIONS_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse();

  const matches = [];
  for (const file of files) {
    try {
      const ed = readJsonCached(path.join(EDITIONS_DIR, file));
      if (!ed) continue;
      for (const sec of ed.sections || []) {
        for (const item of sec.items || []) {
          const haystack = [
            item.headline,
            item.summary,
            ...(item.keyPoints || []),
            item.branchImpact,
            item.source,
            item.insuranceType || "",
            ...(item.bankCategories || []),
            sec.title,
          ]
            .join(" ")
            .toLowerCase();

          if (terms.every((t) => haystack.includes(t))) {
            matches.push({
              ...item,
              sectionTitle: sec.shortTitle,
              editionDate: ed.editionDate,
              editionLabel: ed.editionLabel,
            });
          }
        }
      }
    } catch {
      // ignore corrupted archive entry
    }
  }
  return matches.slice(0, 60);
}

// --- Harvin-Inspired Command Centre Router (Understand -> Department -> Verified Facts -> Answer/Draft) ---
function routeDepartment(query) {
  const q = query.toLowerCase();
  if (/\b(draft|whatsapp|huddle|message|email|brief my team|note for team|pitch note|circular note)\b/.test(q)) {
    return { id: "huddle", name: "Huddle & Communications Desk", sectionFilter: null, wantsDraft: true };
  }
  if (/\b(rbi|circular|kyc|aml|money mule|audit|compliance|penalty|direction|ombudsman|atm|pos|card framework|card payment)\b/.test(q)) {
    return { id: "compliance", name: "Compliance & RBI Desk", sectionFilter: "rbi_regulatory", wantsDraft: false };
  }
  if (/\b(insurance|irdai|health|term|life|ulip|non-life|motor|mediclaim|tpp|bancassurance|hdfc life|hdfc ergo|lic)\b/.test(q)) {
    return { id: "insurance", name: "Insurance & Bancassurance (TPP) Desk", sectionFilter: "insurance", wantsDraft: false };
  }
  if (/\b(msme dream|loan limit|sms alert|upi|credit card|debit card|scheme|charge|amb|aqb|epf|epfo|policy|policies)\b/.test(q)) {
    return { id: "policies", name: "HDFC & Bank Policies Desk", sectionFilter: "bank_policies", wantsDraft: false };
  }
  if (/\b(rate|fd|fixed deposit|scss|mclr|rllr|repo|mpc|emi|bps|yield|interest|senior citizen|small savings|home loan|loan rate)\b/.test(q)) {
    return { id: "pricing", name: "Interest Rates & Pricing Desk", sectionFilter: "interest_rates", wantsDraft: false };
  }
  if (/\b(hdfc|sbi|icici|axis|kotak|msme)\b/.test(q)) {
    return { id: "policies", name: "HDFC & Bank Policies Desk", sectionFilter: "bank_policies", wantsDraft: false };
  }
  if (/\b(fed|ecb|boj|hsbc|standard chartered|dbs|international|global|nri|forex|mutual fund|sip|gold|retirement)\b/.test(q)) {
    return { id: "global", name: "Global, Wealth & Macro Desk", sectionFilter: "finance_macro", wantsDraft: false };
  }
  return { id: "executive", name: "Executive Banking Desk", sectionFilter: null, wantsDraft: false };
}

async function handleCommandQuery(rawQuery) {
  const query = String(rawQuery || "").trim();
  const edition = readLatestEditionSafe();
  if (!edition) {
    return {
      department: "System Desk",
      pipeline: ["Understand", "No edition loaded"],
      answerBullets: ["No daily edition is synced yet. Tap Sync to fetch the latest 24-hour verified updates."],
      sources: [],
      suggestedDraft: null,
    };
  }

  const dept = routeDepartment(query);
  const stopWords = new Set([
    "what", "which", "when", "where", "how", "why", "who", "is", "are", "was", "were", "the", "a", "an",
    "in", "on", "of", "for", "to", "from", "with", "today", "latest", "recent", "news", "update", "updates",
    "tell", "show", "give", "me", "about", "any", "new", "bank", "banks", "draft", "write", "make", "short",
    "whatsapp", "message", "team", "brief", "summarize", "summary", "please", "can", "you", "my",
  ]);

  const keywords = query
    .toLowerCase()
    .replace(/[^a-z0-9\s₹%]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !stopWords.has(w));

  const allItems = (edition.sections || []).flatMap((sec) =>
    (sec.items || []).map((it) => ({ ...it, sectionTitle: sec.shortTitle }))
  );

  // Score items deterministically against user's query + routed department
  const scored = allItems.map((it) => {
    const hay = `${it.headline} ${(it.keyPoints || []).join(" ")} ${it.branchImpact} ${it.source} ${(it.bankCategories || []).join(" ")} ${it.insuranceType || ""} ${it.sectionTitle}`.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (hay.includes(kw)) score += it.headline.toLowerCase().includes(kw) ? 5 : 3;
    }
    if (dept.sectionFilter && it.section === dept.sectionFilter) score += 2;
    if (/\bhdfc\b/i.test(query) && (it.bankCategories || []).includes("HDFC")) score += 4;
    if (/\b(psu|sbi|govt|public)\b/i.test(query) && (it.bankCategories || []).includes("PSU/Govt")) score += 3;
    if (/\b(international|global|foreign|fed|boj|ecb)\b/i.test(query) && (it.bankCategories || []).includes("International")) score += 3;
    if (it.priority === "HIGH") score += 1;
    return { item: it, score };
  });

  scored.sort((a, b) => b.score - a.score);

  let topMatches = scored.filter((s) => s.score >= (keywords.length > 0 ? 3 : 2)).slice(0, 5).map((s) => s.item);
  if (topMatches.length === 0 && dept.sectionFilter) {
    topMatches = allItems.filter((i) => i.section === dept.sectionFilter).slice(0, 4);
  }
  if (topMatches.length === 0) {
    topMatches = allItems.slice(0, 4);
  }

  let answerSummary = `Found ${topMatches.length} verified last-24h item${topMatches.length === 1 ? "" : "s"} in the ${edition.editionDate} edition under ${dept.name}:`;
  let answerBullets = topMatches.map((it) => {
    const fact = it.keyPoints?.[0] || it.summary || it.branchImpact;
    return `**${it.headline}** — ${fact}`;
  });

  let suggestedDraft = null;
  if (dept.wantsDraft || /\b(draft|whatsapp|send|share|prepare.*note)\b/i.test(query)) {
    const primary = topMatches[0];
    suggestedDraft = {
      id: `cmd_draft_${Date.now()}`,
      department: dept.name,
      channel: "WhatsApp / Branch Team Brief",
      title: `Draft Ready for Approval: ${primary ? primary.headline.slice(0, 54) + "…" : "Branch Team Update"}`,
      reason: `Generated from your Command Centre prompt ("${query}") — waiting in Approvals before you copy or share.`,
      body: [
        `*HDFC Bank Panchkula — Executive Desk Brief (${edition.editionDate})*`,
        `Re: ${query}`,
        ``,
        ...topMatches.slice(0, 3).map((m, idx) => `${idx + 1}) *${m.headline}*\n   • ${m.keyPoints?.[0] || m.branchImpact}\n   • _Branch Action:_ ${m.branchImpact}`),
        ``,
        `— Prepared via BM Intel (Verified Official & Tier-1 Sources)`,
      ].join("\n"),
    };
  }

  // Optional Gemini AI prose synthesis strictly grounded in matched verified items
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey && topMatches.length > 0) {
    try {
      const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `You are BM Intel advising Narendra (Branch Manager, HDFC Bank, Panchkula). Answer his query "${query}" strictly using ONLY these verified last-24h facts (never invent numbers or rules). Return JSON: {"summary":"1 crisp line","bullets":["bullet 1","bullet 2","bullet 3"]}.\n\nFacts:\n${JSON.stringify(
                      topMatches.map((m) => ({
                        headline: m.headline,
                        keyPoints: m.keyPoints,
                        branchImpact: m.branchImpact,
                        source: m.source,
                      }))
                    )}`,
                  },
                ],
              },
            ],
            generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
          }),
          signal: AbortSignal.timeout(15000),
        }
      );
      if (res.ok) {
        const gData = await res.json();
        const parsed = JSON.parse(gData?.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
        if (parsed.summary) answerSummary = parsed.summary;
        if (Array.isArray(parsed.bullets) && parsed.bullets.length > 0) {
          answerBullets = parsed.bullets.slice(0, 5);
        }
      }
    } catch {
      // Keep deterministic verified bullets
    }
  }

  appendAuditEntry({
    action: "COMMAND_QUERY",
    department: dept.name,
    status: "OK",
    detail: `Prompt: "${query.slice(0, 90)}" → matched ${topMatches.length} verified 24h items${suggestedDraft ? " + queued approval draft" : ""}.`,
  });

  return {
    query,
    editionDate: edition.editionDate,
    department: dept.name,
    pipeline: [
      "Understand",
      dept.name,
      `${topMatches.length} Verified Facts`,
      suggestedDraft ? "Draft Queued for Approval" : "Executive Answer",
    ],
    summary: answerSummary,
    answerBullets,
    sources: topMatches.map((m) => ({
      headline: m.headline,
      source: m.source,
      url: m.url,
      publishedIst: m.publishedIst,
      branchImpact: m.branchImpact,
      bankCategories: m.bankCategories,
    })),
    suggestedDraft,
  };
}

async function safeRefresh(trigger = "manual") {
  if (isRefreshing) {
    return { alreadyRunning: true };
  }
  isRefreshing = true;
  console.log(`[BM Daily Intel] Starting ${trigger} live refresh...`);
  try {
    const edition = await runIntelFetch();
    console.log(`[BM Daily Intel] Refresh complete (${edition.editionDate}, ${edition.stats.totalItems} items).`);
    return { ok: true, edition };
  } finally {
    isRefreshing = false;
  }
}

// Built-in 8:00 PM IST Scheduler while local server is running
setInterval(() => {
  const ist = getIstParts();
  if (
    ist.hour === SCHEDULE_HOUR_IST &&
    ist.minute === SCHEDULE_MINUTE_IST &&
    lastScheduledRunDate !== ist.dateKey &&
    !isRefreshing
  ) {
    lastScheduledRunDate = ist.dateKey;
    safeRefresh("scheduled-8pm-ist").catch((err) => {
      console.error("[BM Daily Intel] Scheduled refresh error:", err.message);
    });
  }
}, 25_000);

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(reqUrl.pathname);

  // --- API Routes ---
  if (pathname === "/api/status" && req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      isRefreshing,
      scheduleIst: `${String(SCHEDULE_HOUR_IST).padStart(2, "0")}:${String(SCHEDULE_MINUTE_IST).padStart(2, "0")} IST`,
      geminiEnabled: Boolean(process.env.GEMINI_API_KEY),
      lanUrls: getLocalLanUrls(),
      serverMode: "local-live",
    });
  }

  if (pathname === "/api/latest" && req.method === "GET") {
    const latestPath = path.join(DATA_DIR, "latest.json");
    if (!fs.existsSync(latestPath)) {
      try {
        const result = await safeRefresh("initial-boot");
        if (result.edition) return sendJson(res, 200, result.edition);
      } catch (err) {
        return sendJson(res, 500, { error: "Initial fetch failed", detail: err.message });
      }
    }
    const data = readLatestEditionSafe();
    if (!data) {
      return sendJson(res, 500, { error: "Failed to read latest edition" });
    }
    return sendJson(res, 200, data);
  }

  if (pathname === "/api/editions" && req.method === "GET") {
    const data = readJsonCached(path.join(DATA_DIR, "index.json"));
    return sendJson(res, 200, data || { editions: [] });
  }

  if (pathname.startsWith("/api/edition/") && req.method === "GET") {
    const dateKey = pathname.replace("/api/edition/", "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      return sendJson(res, 400, { error: "Invalid edition date format (expected YYYY-MM-DD)" });
    }
    const data = readJsonCached(path.join(EDITIONS_DIR, `${dateKey}.json`));
    if (!data) {
      return sendJson(res, 404, { error: "Edition not found" });
    }
    return sendJson(res, 200, data);
  }

  if (pathname === "/api/search" && req.method === "GET") {
    const q = reqUrl.searchParams.get("q") || "";
    const results = searchAllEditions(q);
    return sendJson(res, 200, { query: q, count: results.length, results });
  }

  if (pathname === "/api/ask" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const result = await handleCommandQuery(body.query || "");
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (pathname === "/api/audit" && req.method === "GET") {
    const logPath = path.join(DATA_DIR, "audit-log.json");
    if (!fs.existsSync(logPath)) return sendJson(res, 200, { entries: [] });
    try {
      const entries = JSON.parse(fs.readFileSync(logPath, "utf8"));
      return sendJson(res, 200, { entries: Array.isArray(entries) ? entries : [] });
    } catch {
      return sendJson(res, 200, { entries: [] });
    }
  }

  if (pathname === "/api/audit" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      appendAuditEntry({
        action: String(body.action || "USER_ACTION").slice(0, 40),
        department: String(body.department || "Branch Leadership").slice(0, 50),
        status: String(body.status || "OK").slice(0, 20),
        detail: String(body.detail || "").slice(0, 220),
      });
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (pathname === "/api/refresh" && req.method === "POST") {
    try {
      const result = await safeRefresh("manual-button");
      if (result.alreadyRunning) {
        return sendJson(res, 202, { status: "already_running" });
      }
      return sendJson(res, 200, result.edition);
    } catch (err) {
      return sendJson(res, 500, { error: "Refresh failed", detail: err.message });
    }
  }

  // --- Static File Serving (PWA) ---
  let safeRelPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolved = path.resolve(PUBLIC_DIR, safeRelPath);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-store, must-revalidate",
    });
    return fs.createReadStream(resolved).pipe(res);
  }

  const fallback = path.join(PUBLIC_DIR, "index.html");
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  return fs.createReadStream(fallback).pipe(res);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("==============================================================");
  console.log("  BM INTEL — Harvin-Style Personal Banking Command Centre");
  console.log("  Tailored for: Narendra, Branch Manager, HDFC Bank Panchkula");
  console.log("==============================================================");
  console.log(`  PC / Laptop URL : http://localhost:${PORT}`);
  const lanUrls = getLocalLanUrls();
  for (const u of lanUrls) {
    console.log(`  Phone (Same WiFi): ${u}`);
  }
  console.log(`  Daily Auto-Sync : ${String(SCHEDULE_HOUR_IST).padStart(2, "0")}:${String(SCHEDULE_MINUTE_IST).padStart(2, "0")} IST`);
  console.log(`  Gemini AI Mode  : ${process.env.GEMINI_API_KEY ? "ENABLED" : "OFF (Deterministic + Deep Article Engine)"}`);
  console.log("==============================================================");
});
