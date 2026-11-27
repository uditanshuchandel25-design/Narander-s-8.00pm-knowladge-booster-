import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FEEDS, SECTIONS } from "./sources.js";
import { evaluateSignal, runSeniorBmEditorAgent } from "./executive-editor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "public", "data");
const EDITIONS_DIR = path.join(DATA_DIR, "editions");

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Load .env if present (zero external dependency)
function loadEnvFile() {
  const envPath = path.join(ROOT_DIR, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}

loadEnvFile();

// --- XML & Text Utilities ---
function decodeEntities(str = "") {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rdquo;/g, "”")
    .replace(/&ldquo;/g, "“")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&#8377;/g, "₹")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripHtml(html = "") {
  return decodeEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(block, tagName) {
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const m = block.match(re);
  return m ? m[1].trim() : "";
}

function extractAttrLink(block) {
  const m = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i);
  return m ? m[1].trim() : "";
}

function parseRssOrAtom(xmlText) {
  const items = [];
  const itemMatches = xmlText.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const raw of itemMatches) {
    const title = stripHtml(extractTag(raw, "title"));
    const link = stripHtml(extractTag(raw, "link")) || stripHtml(extractTag(raw, "guid"));
    const pubDate = stripHtml(extractTag(raw, "pubDate")) || stripHtml(extractTag(raw, "dc:date"));
    const description = stripHtml(extractTag(raw, "description"));
    const contentEncoded = stripHtml(extractTag(raw, "content:encoded"));
    const source = stripHtml(extractTag(raw, "source"));
    if (title && link) {
      items.push({
        title,
        link,
        pubDate,
        description: contentEncoded.length > description.length ? contentEncoded : description,
        source,
      });
    }
  }

  if (items.length === 0) {
    const entryMatches = xmlText.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
    for (const raw of entryMatches) {
      const title = stripHtml(extractTag(raw, "title"));
      const link = extractAttrLink(raw) || stripHtml(extractTag(raw, "id"));
      const pubDate = stripHtml(extractTag(raw, "updated")) || stripHtml(extractTag(raw, "published"));
      const description = stripHtml(extractTag(raw, "summary")) || stripHtml(extractTag(raw, "content"));
      if (title && link) {
        items.push({ title, link, pubDate, description, source: "" });
      }
    }
  }
  return items;
}

function parseDateSafe(dateStr) {
  if (!dateStr) return null;
  const ts = Date.parse(dateStr);
  if (!Number.isNaN(ts)) return new Date(ts);
  const m = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) {
    const d = new Date(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T12:00:00+05:30`);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function formatIstDateKey(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function formatIstReadable(date) {
  return (
    new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }).format(date) + " IST"
  );
}

function formatIstShortTime(date) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

// --- Relevance & Classification ---
const BFSI_INCLUDE_RE = /\b(rbi|reserve bank|irdai|sebi|npci|upi|iba|pfrda|dicgc|nabard|sidbi|bank|banking|nbfc|hdfc|icici|axis|kotak|sbi|state bank|pnb|punjab national|bank of baroda|canara|union bank|bank of india|indusind|idfc|yes bank|hsbc|standard chartered|dbs|citi|federal reserve|us fed|ecb|boe|bank of england|bis|imf|repo rate|mclr|rllr|eblr|fixed deposit|fd rate|rd rate|savings rate|small savings|post office|ppf|ssy|scss|home loan|personal loan|auto loan|msme loan|credit card|debit card|casa|kyc|aml|ombudsman|bancassurance|life insurance|term plan|term insurance|health insurance|general insurance|non-life|motor insurance|lic|hdfc life|hdfc ergo|icici prudential|sbi life|star health|niva bupa|bajaj allianz|mutual fund|amfi|forex|nri|nre|nro|fema|cd ratio|liquidity|treasury|sovereign gold|pension|nps|epfo|epf|interest rate|inflation|gdp|rupee|bond yield|ulip|mediclaim)\b/i;

const NOISE_EXCLUDE_RE = /\b(cricket|ipl|bollywood|movie|box office|horoscope|astrology|celebrity|wedding|recipe|weather forecast|match highlights|web series|bigg boss|stock tips|multibagger|trade spotlight|stocks to buy|best stocks|share price rallies|shares tread|on a tear|intraday|top gainers|stock picks|jpmorgan is bullish|live updates|sensex today|nifty today|gold price today|silver rate today|petrol price|diesel price|bitcoin price|crypto price|bank holiday in (bengaluru|mumbai|chennai|kolkata|hyderabad|kerala|gujarat|karnataka|tamil nadu))\b/i;

function isBfsiRelevant(text) {
  if (NOISE_EXCLUDE_RE.test(text)) return false;
  return BFSI_INCLUDE_RE.test(text);
}

function detectBankCategories(text) {
  const tags = [];
  if (/\b(hdfc bank|hdfc life|hdfc ergo|hdfc mutual|hdfc securities|hdfc)\b/i.test(text)) {
    tags.push("HDFC");
  }
  if (/\b(icici|axis bank|axis mf|axis mutual|kotak|indusind|idfc first|yes bank|federal bank|rbl bank|bandhan bank|south indian bank|karur vysya|private bank|private sector bank|private lender)\b/i.test(text)) {
    tags.push("Private");
  }
  if (/\b(sbi|state bank of india|pnb|punjab national bank|bank of baroda|bob\b|canara bank|union bank|indian bank|bank of india|central bank of india|uco bank|indian overseas bank|psb|psu bank|public sector bank|nationalised|nationalized|ministry of finance|govt bank|government bank|rbi|reserve bank|lic\b)\b/i.test(text)) {
    tags.push("PSU/Govt");
  }
  if (/\b(nabard|sidbi|nhb|exim bank|post office|india post|ippb|small finance bank|au small finance|equitas|ujjivan|jana small|cooperative bank|co-op bank|regional rural bank|rrb|small savings|ppf|scss|sukanya|semi-govt|semi govt|haryana|epfo|epf|nps|pfrda|payment banks?)\b/i.test(text)) {
    tags.push("Semi-Govt");
  }
  if (/\b(hsbc|standard chartered|dbs|citibank|citi|jp morgan|jpmorgan|goldman sachs|barclays|deutsche bank|bank of america|us fed|federal reserve|ecb|bank of england|boj|bis|imf|world bank|foreign bank|international bank|global bank|swift|forex|nri|fema|dollar|nomura|wall street|treasury yield|u\.s\.|european central bank)\b/i.test(text)) {
    tags.push("International");
  }
  return tags.length > 0 ? tags : ["PSU/Govt"];
}

function detectInsuranceSubType(text) {
  if (/\b(term plan|term insurance|term life|pure protection)\b/i.test(text)) return "Term";
  if (/\b(health insurance|mediclaim|cashless hospital|medical insurance|star health|niva bupa|care health|hdfc ergo health|ayushman)\b/i.test(text)) return "Health";
  if (/\b(motor insurance|car insurance|crop insurance|fire insurance|cyber insurance|general insurance|non-life|non life|marine insurance|travel insurance|property insurance|hdfc ergo|icici lombard|bajaj allianz general|new india assurance|oriental insurance)\b/i.test(text)) return "Non-Life";
  if (/\b(life insurance|endowment|ulip|annuity|pension plan|lic|hdfc life|sbi life|icici prudential|max life|axis max life|bajaj allianz life|surrender value)\b/i.test(text)) return "Life";
  if (/\b(irdai|insurer|insurance|bancassurance|claim settlement|bima)\b/i.test(text)) return "IRDAI / All";
  return null;
}

function isRoutineRbiMarketOp(text) {
  return /\b(weekly statistical supplement|auction of (91-day|182-day|364-day|state government|government of india)|treasury bills|variable rate repo|vrr auction|vrrr auction|underwriting auction|market borrowing|forex reserves)\b/i.test(text);
}

function classifySection(text, feed) {
  if (isRoutineRbiMarketOp(text)) {
    return "finance_macro";
  }

  if (feed.id === "rbi_press" || feed.id === "rbi_notifications") {
    if (/\b(repo rate|mpc|monetary policy|standing deposit facility|bank rate|sovereign gold bond|floating rate savings bond)\b/i.test(text)) {
      return "interest_rates";
    }
    return "rbi_regulatory";
  }

  if (feed.id === "bs_insurance" || feed.id === "mint_insurance" || /\b(irdai|life insurance|term plan|term insurance|health insurance|general insurance|non-life|non life|motor insurance|bancassurance|hdfc life|hdfc ergo|sbi life|icici prudential|icici lombard|star health|niva bupa|lic of india|surrender value|claim settlement|mediclaim|bima|ulip)\b/i.test(text)) {
    return "insurance";
  }

  if (/\b(lost.*property papers|compensation|high court orders bank|supreme court.*bank|monetary penalty|rbi imposes penalty|money mule|know your customer|amendment directions|master direction|ombudsman|kyc|re-kyc|aml|cyber-enabled financial fraud|atm.*directions|white label atm)\b/i.test(text)) {
    return "rbi_regulatory";
  }

  if (/\b(sms alert|stop sms|upi payments up to|credit card|debit card|lounge access|reward points|service charge|amb|aqb|minimum balance|salary account|current account|msme dream|new scheme|launches|atm fee|cheque|waiver|account rule|zero balance|bank policy|revised rules|withdrawal rules)\b/i.test(text)) {
    return "bank_policies";
  }

  if (/\b(fd rate|fixed deposit|rd rate|recurring deposit|savings account interest|mclr|rllr|eblr|repo rate|reverse repo|mpc|base rate|home loan rate|car loan rate|personal loan rate|msme loan rate|interest rate|small savings|ppf rate|scss|lending rate|deposit rate|rate cut|rate hike|bps|emi|fed.*rate|ecb.*rate)\b/i.test(text)) {
    return "interest_rates";
  }

  if (/\b(rbi|reserve bank|circular|guideline|audit|compliance|priority sector|psl|digital lending|fema|iba|indian banks association|dicgc|fraud|dormant account|unclaimed deposit|locker)\b/i.test(text)) {
    return "rbi_regulatory";
  }

  return feed.defaultSection || "finance_macro";
}

function computePriority(text, section, bankTags, feed) {
  if (isRoutineRbiMarketOp(text)) return "STANDARD";
  let score = 0;
  if (feed.tier === "Official Regulator" || feed.tier === "Official Government") score += 4;
  if (bankTags.includes("HDFC")) score += 5;
  if (section === "rbi_regulatory" || section === "interest_rates" || section === "bank_policies" || section === "insurance") score += 3;
  if (/\b(circular|guideline|master direction|amendment directions|money mule|penalty|kyc|repo rate|mclr|fd rate|irdai|hdfc bank|hdfc life|hdfc ergo|sms alert|msme|rate cut|rate hike|compensation|health insurance|term plan|sbi|icici|axis)\b/i.test(text)) {
    score += 3;
  }
  if (score >= 7) return "HIGH";
  if (score >= 4) return "MEDIUM";
  return "STANDARD";
}

function buildBranchImpact(text, section, bankTags, insuranceType) {
  const isHdfc = bankTags.includes("HDFC");
  if (section === "rbi_regulatory") {
    if (/\b(money mule|cyber|fraud)\b/i.test(text)) {
      return "Critical Ops Alert: Tighten new CASA onboarding scrutiny, high-velocity account monitoring & RM KYC checks for suspected mule indicators immediately.";
    }
    if (/\b(lost.*property|title deed|compensation|high court|ombudsman)\b/i.test(text)) {
      return "Safe Custody & Audit Lesson: Audit branch loan-closure title deed release TAT (RBI mandates 30-day return); zero tolerance for misplaced collateral documents.";
    }
    if (/\b(atm|pos|cash withdrawal|white label)\b/i.test(text)) {
      return "Branch Ops & ATM Desk: Review ATM/POS cash withdrawal reconciliation, failed-txn TAT, and customer dispute escalation workflow.";
    }
    if (/\b(msme|standing advisory)\b/i.test(text)) {
      return "MSME Credit Push: RBI is closely reviewing MSME credit flow—prioritize Panchkula Industrial Area working-capital & CGTMSE files.";
    }
    if (/\b(penalty|fine|action|ban|restriction)\b/i.test(text)) {
      return "Audit Defense: Verify branch KYC/compliance controls on this exact point to prevent concurrent or RBI inspection findings.";
    }
    if (/\b(kyc|know your customer|aml|dormant|unclaimed|locker)\b/i.test(text)) {
      return "Counter Compliance: Brief Personal Bankers & Tellers in morning huddle; verify Re-KYC and documentation completeness before closure.";
    }
    return "Regulatory Watch: Monitor corresponding HDFC Bank internal circular before modifying frontline counter SOPs.";
  }
  if (section === "interest_rates") {
    if (isHdfc) {
      return "HDFC Pricing Action: Update RM pitch decks immediately and proactively call maturing FD / pipeline loan clients.";
    }
    if (/\b(mclr|rllr|eblr|lending rate)\b/i.test(text)) {
      return "Loan Pipeline Opportunity: Competitor lending cost is shifting—activate balance-transfer (BT) and new sanction pitches for Panchkula salaried & MSME borrowers.";
    }
    if (/\b(rate hike|50 bps|25 bps|mpc|repo rate|emi|rate cut)\b/i.test(text)) {
      return "Rate-Cycle Advisory: Prep RMs to advise FD customers on laddering/tenure strategy and guide home-loan borrowers on EMI/tenure impact.";
    }
    if (bankTags.includes("International")) {
      return "Global Rate & NRI Angle: Global central bank moves impact forex & FCNR/NRE deposit conversations with Tricity NRI families.";
    }
    if (bankTags.includes("PSU/Govt") || bankTags.includes("Semi-Govt")) {
      return "PSU/Govt Competitor Move: Counter with HDFC Bank's service TAT, Imperia/Preferred privileges, and bundled CASA+TPP relationship value.";
    }
    return "Pricing Radar: Benchmark against current HDFC Bank rate card before negotiating rate approvals or renewals.";
  }
  if (section === "insurance") {
    if (insuranceType === "Term") {
      return "TPP Sales Hook (Term): Pitch pure-protection term cover to salaried & MSME loan borrowers during onboarding and annual reviews.";
    }
    if (insuranceType === "Health") {
      return "TPP Sales Hook (Health): Lead with HDFC ERGO cashless hospital network, claim transparency & family floater upgrades for walk-in and HNI clients.";
    }
    if (insuranceType === "Non-Life") {
      return "TPP Sales Hook (Non-Life): Cross-sell fire/shop/commercial/motor protection to Panchkula Industrial Area MSME & auto loan customers.";
    }
    if (/\b(ulip)\b/i.test(text)) {
      return "Wealth & Life Pitch: Use objective ULIP vs Term+MF risk/tax framing to build long-term trust during HNI HDFC Life reviews.";
    }
    return "Bancassurance Angle: Align HDFC Life / HDFC ERGO pitch with latest IRDAI rules and emphasize claim-settlement reliability.";
  }
  if (section === "bank_policies") {
    if (isHdfc && /\b(sms|upi)\b/i.test(text)) {
      return "Immediate Desk Readiness (HDFC): Brief all PBs, Tellers & RMs on the Jan 1, 2027 ₹500 UPI SMS-alert change so customers are proactively guided to email/app alerts without confusion.";
    }
    if (isHdfc) {
      return "Direct HDFC Policy Update: Circulate internally at the 9:30 AM huddle so every counter gives uniform, accurate customer guidance.";
    }
    if (/\b(msme)\b/i.test(text)) {
      return "MSME Competitive Defense: Counter PSU MSME pushes across Panchkula Phase 1 & 2 with HDFC Bank's faster sanction TAT, CMS, and working-capital bundling.";
    }
    if (/\b(epf|epfo|retiree|pension)\b/i.test(text)) {
      return "Pensioner & Retiree Desk: Use EPF payout updates as a warm conversation starter for Tricity retirees on Senior Citizen FD, SCSS & annuity planning.";
    }
    return "Peer Intelligence: Benchmark against HDFC Bank's product suite to protect corporate salary, HNI, and current account mandates.";
  }
  if (bankTags.includes("International")) {
    return "NRI / Forex Relevance: Useful talking point for Tricity NRI families, foreign remittances, and FCNR/NRE deposit discussions.";
  }
  return "Liquidity & Macro Context: Keep RMs informed on system liquidity, mutual funds, and sovereign yields affecting bulk FD and wealth pitches.";
}

function normalizeForDedup(str) {
  return str
    .toLowerCase()
    .replace(/[-–—]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w.length > 2 &&
        !["the", "and", "for", "with", "from", "that", "this", "over", "into", "says", "said", "india", "bank", "banks", "may", "will", "new", "here", "what", "how", "why"].includes(w)
    );
}

function isDuplicate(aTokens, bTokens) {
  if (aTokens.length === 0 || bTokens.length === 0) return false;
  const setB = new Set(bTokens);
  let overlap = 0;
  for (const t of aTokens) {
    if (setB.has(t)) overlap++;
  }
  const ratio = overlap / Math.min(aTokens.length, bTokens.length);
  return ratio >= 0.52;
}

// --- Deep Live Article & Official Circular Summarizer ---
const BOILERPLATE_SENTENCE_RE = /\b(subscribe|sign up|download.*app|follow us|whatsapp channel|telegram channel|read more|also read|click here|disclaimer|copyright|all rights reserved|story continues|advertisement|watch live|cookie|privacy policy|terms of use|edited by|published on|updated on|first published|join us on|check out|stay tuned|get latest|courtesy:|file photo|image:|representative image|sl\.\s*no\.|sr\.\s*no\.|deputy general manager\s*\(communications\)|press release:\s*20\d{2}|statement on the feedback received is provided in the annex)\b/i;

function sanitizeProse(text = "") {
  return text
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/([a-z0-9%\)])\.([A-Z₹])/g, "$1. $2")
    .replace(/(%)([A-Z])/g, "$1. $2")
    .replace(/\s+\./g, ".")
    .replace(/\s+,/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function extractJsonLdTexts(html) {
  const chunks = [];
  const matches = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of matches) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const nodes = Array.isArray(parsed) ? parsed : parsed["@graph"] ? parsed["@graph"] : [parsed];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        if (typeof node.articleBody === "string" && node.articleBody.length > 80) {
          chunks.push(stripHtml(node.articleBody));
        }
        if (typeof node.description === "string" && node.description.length > 50) {
          chunks.push(stripHtml(node.description));
        }
      }
    } catch {
      // Ignore malformed JSON-LD blocks
    }
  }
  return chunks;
}

function extractMetaDescriptions(html) {
  const out = [];
  const patterns = [
    /<meta[^>]+(?:name|property)=["'](?:og:description|description|twitter:description)["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:og:description|description|twitter:description)["']/gi,
  ];
  for (const re of patterns) {
    for (const m of html.matchAll(re)) {
      const clean = stripHtml(m[1]);
      if (clean.length >= 45 && !BOILERPLATE_SENTENCE_RE.test(clean)) {
        out.push(clean);
      }
    }
  }
  return out;
}

function extractHtmlParagraphs(html) {
  // Strip noisy structural regions first
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ");

  const paras = [];
  for (const m of cleaned.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi)) {
    const text = stripHtml(m[1]);
    if (text.length < 48 || text.length > 750) continue;
    if (BOILERPLATE_SENTENCE_RE.test(text)) continue;
    // Skip navigation/link-heavy lines with very few spaces or too many pipes
    if ((text.match(/\|/g) || []).length >= 2) continue;
    paras.push(text);
    if (paras.length >= 12) break;
  }
  return paras;
}

function splitIntoSentences(text) {
  if (!text) return [];
  // Clean invisible chars & missing spaces after periods first
  const cleaned = sanitizeProse(text);
  // Protect common banking abbreviations from sentence splitting
  const safe = cleaned
    .replace(/\b(Rs|Mr|Mrs|Ms|Dr|No|Sr|Sl|Inc|Ltd|Co|U\.S|U\.K|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Sec|Para|approx)\./g, "$1<DOT>")
    .replace(/(\d)\.(\d)/g, "$1<DOT>$2");

  return safe
    .split(/(?<=[.!?])\s+(?=[A-Z₹"‘“\d])/)
    .map((s) => s.replace(/<DOT>/g, ".").replace(/^\d+\.\s*/, "").replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 42 && s.length <= 340);
}

function scoreSentence(sentence, idx, headlineTokens) {
  if (BOILERPLATE_SENTENCE_RE.test(sentence)) return -100;
  // Reject sentences that are almost identical to headline
  const sTokens = normalizeForDedup(sentence);
  if (isDuplicate(sTokens, headlineTokens) && sentence.length < 130) return -50;

  let score = 0;
  // Early lead sentences carry core news facts
  if (idx <= 1) score += 5;
  else if (idx <= 4) score += 3;
  else if (idx <= 8) score += 1;

  // High value: numbers, rates, currency, dates, bps, percentages
  if (/(₹|Rs\.?\s*\d|\d+(\.\d+)?%|\bbps\b|\bcrore\b|\blakh\b|\bbillion\b|\bmillion\b|\b202[6-9]\b)/i.test(sentence)) {
    score += 5;
  }
  // Concrete effective date or timeline
  if (/\b(effective|from\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)|within\s+\d+|deadline|by\s+(march|december|202\d)|starting|w\.e\.f)\b/i.test(sentence)) {
    score += 4;
  }
  // Actionable banking/regulatory verbs
  if (/\b(directed|mandated|amended|revised|hiked|raised|cut|reduced|announced|approved|set up|constituted|launched|discontinue|stop|requires|applicable|customers|borrowers|policyholders|depositors|lenders|banks|insurers|claim|kyc|mclr|repo|upi|sms|msme)\b/i.test(sentence)) {
    score += 3;
  }
  // Ideal executive bullet length
  if (sentence.length >= 65 && sentence.length <= 215) score += 2;
  return score;
}

function trimBullet(text, maxLen = 215) {
  let s = sanitizeProse(text);
  // Clean stray wire city prefixes like "MUMBAI:" or "MUMBAI "
  s = s.replace(/^(?:MUMBAI|NEW DELHI|DELHI|BENGALURU|KOLKATA|CHENNAI|HYDERABAD|WASHINGTON|TOKYO|LONDON)[:,\s]+(?=[A-Z])/i, "");
  s = s.replace(/\.\d+\.?$/, ".");
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const lastBreak = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "), cut.lastIndexOf(", "));
  return lastBreak > 95 ? `${cut.slice(0, lastBreak).trim()}.` : `${cut.trim()}…`;
}

function buildCrispBulletsFromTexts(headline, candidateTexts) {
  const headlineTokens = normalizeForDedup(headline);
  const allSentences = [];
  const seenTokens = [headlineTokens];

  for (const block of candidateTexts) {
    const sentences = splitIntoSentences(block);
    for (const s of sentences) {
      const toks = normalizeForDedup(s);
      if (toks.length < 4) continue;
      if (seenTokens.some((existing) => isDuplicate(toks, existing))) continue;
      seenTokens.push(toks);
      allSentences.push(s);
    }
  }

  const scored = allSentences
    .map((sentence, idx) => ({
      sentence,
      idx,
      score: scoreSentence(sentence, idx, headlineTokens),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .sort((a, b) => a.idx - b.idx);

  return scored.map((x) => trimBullet(x.sentence));
}

function buildRbiNotificationStructuredPoints(item, allPool) {
  const h = item.headline;
  const genericStop = new Set([
    "reserve", "directions", "amendment", "2026", "2025", "2027", "india", "bank", "banks",
    "transactions", "transaction", "through", "based", "digital", "payments", "payment",
  ]);
  const hTokens = normalizeForDedup(h).filter((w) => !genericStop.has(w));

  // Match strictly against another item's HEADLINE (not full body) with domain-specific terms
  const related = allPool.find((other) => {
    if (other.url === item.url) return false;
    if (!other._extractedTexts || other._extractedTexts.length === 0) return false;
    const oHeadTokens = new Set(normalizeForDedup(other.headline));
    const overlap = hTokens.filter((t) => oHeadTokens.has(t)).length;
    if (/know your customer|kyc/i.test(h) && /money mule|know your customer|kyc/i.test(other.headline)) return true;
    if (/card-based/i.test(h) && /card payment|credit card|debit card/i.test(other.headline)) return true;
    return overlap >= 2;
  });

  if (related) {
    const crossBullets = buildCrispBulletsFromTexts(h, related._extractedTexts);
    if (crossBullets.length >= 2) {
      return crossBullets;
    }
  }

  const entityMatch = h.match(/\(([^)]+)\)/);
  const scope = entityMatch ? entityMatch[1] : "Regulated Banking Entities";
  const points = [
    `Official RBI statutory direction issued on ${item.publishedIst} IST governing ${scope}.`,
  ];
  if (/know your customer|kyc/i.test(h)) {
    points.push("Amends mandatory KYC onboarding checks, customer due diligence, and suspicious-account monitoring norms.");
  } else if (/card-based/i.test(h)) {
    points.push("Consolidates and standardizes regulatory rules governing debit/credit card transactions, authentication, and merchant fee ceilings.");
  } else if (/cash withdrawal|automated teller|point of sale/i.test(h)) {
    points.push("Updates operational directions for cash withdrawals via ATMs and POS terminals, including limits, security, and failed-transaction reconciliation.");
  } else if (/white label atm/i.test(h)) {
    points.push("Revises licensing, operational standards, cash management, and regulatory compliance for White Label ATM Operators (WLAOs).");
  } else {
    points.push("Introduces updated regulatory compliance norms—review the linked official RBI circular PDF for exact effective dates and clauses.");
  }
  return points;
}

async function fetchArticleExtractedTexts(item) {
  const texts = [];
  if (item._rssDescription && item._rssDescription.length >= 45) {
    texts.push(item._rssDescription);
  }

  // Skip fetching NotificationUser.aspx (it's a PDF viewer shell with no inline body paragraphs)
  if (item.url.includes("rbi.org.in/scripts/NotificationUser.aspx")) {
    return texts;
  }

  try {
    const res = await fetch(item.url, {
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-IN,en;q=0.9",
      },
      signal: AbortSignal.timeout(6500),
    });
    if (!res.ok) return texts;
    const html = await res.text();
    const jsonLd = extractJsonLdTexts(html);
    const paras = extractHtmlParagraphs(html);
    const metas = extractMetaDescriptions(html);

    // Prioritize clean structured article body & lead paragraphs over meta tags
    texts.push(...jsonLd, ...paras, ...metas);
  } catch {
    // Graceful fallback to RSS description
  }
  return texts;
}

async function enrichCuratedItems(curatedFlat) {
  // Fetch full webpage text in controlled parallel batches of 6
  const BATCH_SIZE = 6;
  for (let i = 0; i < curatedFlat.length; i += BATCH_SIZE) {
    const batch = curatedFlat.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (item) => {
        item._extractedTexts = await fetchArticleExtractedTexts(item);
      })
    );
  }

  // Generate 2–3 crisp executive bullet points for EVERY single item
  for (const item of curatedFlat) {
    let bullets = buildCrispBulletsFromTexts(item.headline, item._extractedTexts || []);

    if (bullets.length < 2 && item.source === "RBI Notifications") {
      bullets = buildRbiNotificationStructuredPoints(item, curatedFlat);
    }

    if (bullets.length === 0 && item._rssDescription && item._rssDescription.length >= 35) {
      bullets = [trimBullet(item._rssDescription, 220)];
    }

    if (bullets.length === 0) {
      bullets = [
        `Reported by ${item.source} (${item.publishedIst} IST) under ${item.bankCategories.join(" / ")} banking coverage.`,
        "Open the verified source link for complete figures and official annexures.",
      ];
    }

    item.keyPoints = bullets.slice(0, 3);
    item.summary = item.keyPoints[0] || "";
  }
}

function buildMorningHuddle(sectionsMap) {
  const rbiTop = sectionsMap.rbi_regulatory[0];
  const rateTop = sectionsMap.interest_rates[0];
  const insTop = sectionsMap.insurance[0];
  const macroTop = sectionsMap.finance_macro[0];

  const hdfcPolicy = sectionsMap.bank_policies.find((i) => i.bankCategories.includes("HDFC"));
  const rivalPolicy = sectionsMap.bank_policies.find((i) => !i.bankCategories.includes("HDFC"));

  const salesHook = rateTop
    ? `Rate Pitch: "${rateTop.headline}" (${rateTop.source}) — ${rateTop.keyPoints?.[0] || "Reach out to maturing FD and pipeline loan clients today before rate expectations shift."}`
    : insTop
      ? `TPP Pitch: "${insTop.headline}" — position HDFC Life / HDFC ERGO protection during every CASA and locker visit.`
      : "Focus RMs on CASA deepening and FD/TPP cross-sell for salaried, pensioner, and Panchkula MSME walk-ins.";

  const competitorCounter = rivalPolicy
    ? `Peer Counter: "${rivalPolicy.headline}" (${rivalPolicy.source}) — Counter across Panchkula with HDFC Bank's faster digital sanction TAT, CMS/working-capital bundling, and Imperia/Preferred relationship depth.`
    : rateTop
      ? `If clients cite peer rates ("${rateTop.headline}"), anchor on total relationship value—digital banking ease, dedicated RM continuity, and bundled card/locker benefits.`
      : "Differentiate against PSU & private rivals on turnaround speed, seamless digital journeys, and end-to-end wealth/TPP advisory.";

  const opsAlert = hdfcPolicy
    ? `Frontline Policy + Compliance: (1) Brief every PB/Teller on "${hdfcPolicy.headline}"; (2) Flag RBI update "${rbiTop ? rbiTop.headline : "KYC & fraud vigilance"}" for strict counter & audit discipline.`
    : rbiTop
      ? `Compliance Check: "${rbiTop.headline}" (${rbiTop.source}) — verify KYC/documentation discipline at counters and track HDFC Bank's internal circular.`
      : "Routine Audit Discipline: Zero pending Re-KYC discrepancies, strict cash/locker register sign-offs, and same-day closure of customer escalations.";

  const tppFocus = insTop
    ? `Insurance Desk (${insTop.insuranceType || "TPP"}): "${insTop.headline}" — ${insTop.keyPoints?.[0] || "Align PB & Insurance RM pitch on suitability, tax clarity, and claim-settlement trust."}`
    : macroTop
      ? `Wealth & NRI Talking Point: "${macroTop.headline}" — equip RMs for HNI, treasury, and NRI client conversations.`
      : "Target 100% protection pitch coverage (Term + Health) on every new Home Loan and HNI account onboarding today.";

  return {
    title: "Next-Day 9:30 AM Panchkula Branch Huddle Playbook",
    salesHook,
    competitorCounter,
    opsAlert,
    tppFocus,
  };
}

function buildPendingDrafts(sectionsMap, morningHuddle, editionDateKey) {
  const drafts = [];

  // Draft 1: Next-Day 9:30 AM Panchkula Branch Morning Huddle (WhatsApp Ready)
  drafts.push({
    id: `huddle_${editionDateKey}`,
    department: "Branch Leadership · Huddle",
    channel: "WhatsApp / Team Huddle",
    title: "9:30 AM Panchkula Morning Huddle Brief",
    reason: "Prepared from verified last-24h RBI, pricing, policy & insurance updates — awaiting your approval before sharing.",
    body: [
      `*HDFC Bank Panchkula — 9:30 AM Morning Huddle*`,
      `Edition: ${editionDateKey} (8:00 PM IST Intel)`,
      ``,
      `1) *Sales Hook:* ${morningHuddle.salesHook}`,
      ``,
      `2) *Competitor Counter:* ${morningHuddle.competitorCounter}`,
      ``,
      `3) *Ops & Compliance Alert:* ${morningHuddle.opsAlert}`,
      ``,
      `4) *Insurance / TPP Focus:* ${morningHuddle.tppFocus}`,
      ``,
      `— BM Desk · Verified Official & Tier-1 Sources`,
    ].join("\n"),
  });

  // Draft 2: Direct HDFC / Frontline Policy Desk Note (if any HDFC update exists today)
  const hdfcItem =
    sectionsMap.bank_policies.find((i) => i.bankCategories.includes("HDFC")) ||
    sectionsMap.interest_rates.find((i) => i.bankCategories.includes("HDFC"));

  if (hdfcItem) {
    drafts.push({
      id: `hdfc_note_${editionDateKey}`,
      department: "Frontline Ops & Customer Desk",
      channel: "Internal PB / Teller Brief",
      title: `Desk Note: ${hdfcItem.headline.slice(0, 68)}${hdfcItem.headline.length > 68 ? "…" : ""}`,
      reason: "Direct HDFC Bank development spotted in last 24h — approve to circulate uniform guidance to PBs & Tellers.",
      body: [
        `*Team Desk Note — HDFC Bank Update (${editionDateKey})*`,
        `Topic: ${hdfcItem.headline}`,
        ``,
        ...(hdfcItem.keyPoints || []).map((pt) => `• ${pt}`),
        ``,
        `*Action at Counters:* ${hdfcItem.branchImpact}`,
        `Source: ${hdfcItem.source}`,
      ].join("\n"),
    });
  }

  // Draft 3: Top RBI Compliance Reminder (if any High-Priority RBI circular exists today)
  const rbiHigh = sectionsMap.rbi_regulatory.find((i) => i.priority === "HIGH");
  if (rbiHigh) {
    drafts.push({
      id: `rbi_alert_${editionDateKey}`,
      department: "Compliance & Audit Desk",
      channel: "Branch Ops / RM Checklist",
      title: `Compliance Alert: ${rbiHigh.headline.slice(0, 62)}${rbiHigh.headline.length > 62 ? "…" : ""}`,
      reason: "Official RBI directive published in last 24h — review & approve to brief branch operations staff.",
      body: [
        `*RBI Regulatory Watch (${editionDateKey})*`,
        `${rbiHigh.headline}`,
        ``,
        ...(rbiHigh.keyPoints || []).map((pt) => `• ${pt}`),
        ``,
        `*Branch Ops Check:* ${rbiHigh.branchImpact}`,
        `Official Link: ${rbiHigh.url}`,
      ].join("\n"),
    });
  }

  return drafts;
}

export function appendAuditEntry(entry) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const logPath = path.join(DATA_DIR, "audit-log.json");
    let entries = [];
    if (fs.existsSync(logPath)) {
      entries = JSON.parse(fs.readFileSync(logPath, "utf8"));
      if (!Array.isArray(entries)) entries = [];
    }
    const now = new Date();
    entries.unshift({
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestampUtc: now.toISOString(),
      timestampIst: formatIstShortTime(now) + " IST",
      ...entry,
    });
    fs.writeFileSync(logPath, JSON.stringify(entries.slice(0, 80), null, 2), "utf8");
  } catch {
    // Non-fatal audit write failure
  }
}

// --- Optional Gemini AI Senior Researcher Upgrade ---
async function synthesizeWithGemini(items, editionDateReadable) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || items.length === 0) return null;

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const compactInput = items.slice(0, 35).map((item, idx) => ({
    id: idx + 1,
    section: item.section,
    bankCategories: item.bankCategories,
    insuranceType: item.insuranceType,
    headline: item.headline,
    extractedFacts: (item.keyPoints || []).join(" "),
    source: item.source,
    publishedIst: item.publishedIst,
  }));

  const prompt = `You are a Senior Branch Manager and Senior Banking Sales & Operations Researcher advising Narendra (Branch Manager, HDFC Bank, Panchkula — Tricity market with Haryana Govt/Semi-Govt, PSU, Pensioner, MSME, Salaried, HNI & NRI segments).

Below are verified last-24-hour items with extracted factual excerpts for the ${editionDateReadable} (8:00 PM IST) edition.
Using ONLY facts present in the verified inputs (NEVER invent numbers, rates, or circulars):
1. "topFive": Array of 5 crisp 1-sentence executive highlights (60-second pulse) citing item "id".
2. "refined": Object mapping item "id" (as string) -> { "keyPoints": ["crisp factual bullet 1", "crisp factual bullet 2"], "branchImpact": "1 sharp actionable sentence for HDFC Bank Panchkula BM/RMs/Ops" } for ALL items.
3. "huddle": { "salesHook": "...", "competitorCounter": "...", "opsAlert": "...", "tppFocus": "..." } — crisp Pure English for tomorrow's 9:30 AM huddle.

Respond strictly as valid JSON matching:
{
  "topFive": [{ "id": 1, "text": "..." }],
  "refined": { "1": { "keyPoints": ["...", "..."], "branchImpact": "..." } },
  "huddle": { "salesHook": "...", "competitorCounter": "...", "opsAlert": "...", "tppFocus": "..." }
}

Verified items:
${JSON.stringify(compactInput)}`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      }),
      signal: AbortSignal.timeout(28000),
    });

    if (!res.ok) {
      console.warn(`[Gemini] API HTTP ${res.status} — using Deep Article Executive Engine.`);
      return null;
    }
    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return null;
    return JSON.parse(rawText);
  } catch (err) {
    console.warn(`[Gemini] Synthesis skipped (${err.message}) — using Deep Article Executive Engine.`);
    return null;
  }
}

// --- Main Fetch Pipeline ---
export async function runIntelFetch() {
  fs.mkdirSync(EDITIONS_DIR, { recursive: true });

  const feedHealth = [];
  const rawCollected = [];
  const serverNowCandidates = [];

  await Promise.all(
    FEEDS.map(async (feed) => {
      const started = Date.now();
      try {
        const res = await fetch(feed.url, {
          headers: {
            "User-Agent": BROWSER_UA,
            "Accept": "application/rss+xml, application/xml, text/xml, */*",
          },
          signal: AbortSignal.timeout(12000),
        });

        const dateHeader = res.headers.get("date");
        if (dateHeader) {
          const parsedHeader = Date.parse(dateHeader);
          if (!Number.isNaN(parsedHeader)) serverNowCandidates.push(parsedHeader);
        }

        if (!res.ok) {
          feedHealth.push({
            id: feed.id,
            name: feed.name,
            tier: feed.tier,
            status: "WARN",
            httpStatus: res.status,
            fetched: 0,
            verified24h: 0,
            ms: Date.now() - started,
          });
          return;
        }

        const xml = await res.text();
        const parsed = parseRssOrAtom(xml);
        feedHealth.push({
          id: feed.id,
          name: feed.name,
          tier: feed.tier,
          status: "OK",
          httpStatus: res.status,
          fetched: parsed.length,
          verified24h: 0,
          ms: Date.now() - started,
        });

        for (const item of parsed) {
          rawCollected.push({ ...item, feed });
        }
      } catch (err) {
        feedHealth.push({
          id: feed.id,
          name: feed.name,
          tier: feed.tier,
          status: "ERROR",
          error: err.message,
          fetched: 0,
          verified24h: 0,
          ms: Date.now() - started,
        });
      }
    })
  );

  const referenceNowMs = serverNowCandidates.length > 0 ? Math.max(...serverNowCandidates) : Date.now();
  const referenceNow = new Date(referenceNowMs);
  const window24hMs = 24 * 60 * 60 * 1000;
  const effectiveWindowMs = 26 * 60 * 60 * 1000;

  const healthById = Object.fromEntries(feedHealth.map((h) => [h.id, h]));
  const accepted = [];
  const tokenIndex = [];

  for (const raw of rawCollected) {
    const pubDateObj = parseDateSafe(raw.pubDate);
    if (!pubDateObj) continue;

    const ageMs = referenceNowMs - pubDateObj.getTime();
    if (ageMs < -6 * 3600 * 1000 || ageMs > effectiveWindowMs) continue;

    const title = (raw.title || "").trim();
    if (!title || title.length < 18) continue;

    const combinedText = `${title} ${raw.description || ""}`;
    if (raw.feed.requireBfsiFilter && !isBfsiRelevant(combinedText)) continue;
    if (NOISE_EXCLUDE_RE.test(combinedText)) continue;

    const tokens = normalizeForDedup(title);
    if (tokenIndex.some((existing) => isDuplicate(tokens, existing))) continue;
    tokenIndex.push(tokens);

    const section = classifySection(combinedText, raw.feed);
    const bankCategories = detectBankCategories(combinedText);
    const insuranceType = section === "insurance" ? detectInsuranceSubType(combinedText) : null;
    const priority = computePriority(combinedText, section, bankCategories, raw.feed);
    const branchImpact = buildBranchImpact(combinedText, section, bankCategories, insuranceType);

    if (healthById[raw.feed.id]) {
      healthById[raw.feed.id].verified24h += 1;
    }

    accepted.push({
      id: `${raw.feed.id}_${accepted.length + 1}`,
      headline: title,
      _rssDescription: raw.description || "",
      keyPoints: [],
      summary: "",
      branchImpact,
      section,
      bankCategories,
      insuranceType,
      priority,
      source: raw.feed.name,
      sourceTier: raw.feed.tier,
      url: raw.link,
      publishedAt: pubDateObj.toISOString(),
      publishedIst: formatIstShortTime(pubDateObj),
      withinStrict24h: ageMs <= window24hMs,
    });
  }

  const prioRank = { HIGH: 3, MEDIUM: 2, STANDARD: 1 };
  accepted.sort((a, b) => {
    const diff = prioRank[b.priority] - prioRank[a.priority];
    if (diff !== 0) return diff;
    return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
  });

  // Efficiency Gate: Pre-filter beginner/routine explainers BEFORE capping & BEFORE deep-fetching article HTML
  // Saves network/CPU time AND ensures real net-new signals aren't crowded out of section slots!
  const maxPerSection = {
    rbi_regulatory: 6,
    interest_rates: 6,
    bank_policies: 6,
    insurance: 6,
    finance_macro: 6,
  };

  const sectionsMap = {
    rbi_regulatory: [],
    interest_rates: [],
    bank_policies: [],
    insurance: [],
    finance_macro: [],
  };
  const preSuppressed = [];

  for (const item of accepted) {
    const preVerdict = evaluateSignal({
      headline: item.headline,
      source: item.source,
      keyPoints: item._rssDescription ? [item._rssDescription] : [],
    });
    if (!preVerdict.isSignal) {
      const secMeta = SECTIONS.find((s) => s.id === item.section);
      preSuppressed.push({
        id: item.id,
        headline: item.headline,
        source: item.source,
        url: item.url,
        publishedIst: item.publishedIst,
        sectionId: item.section,
        sectionTitle: secMeta?.shortTitle || item.section,
        suppressedReason: preVerdict.reason,
        isExecutiveSignal: false,
      });
      continue;
    }

    const bucket = sectionsMap[item.section];
    if (bucket && bucket.length < (maxPerSection[item.section] || 6)) {
      bucket.push(item);
    }
  }

  const curatedFlat = SECTIONS.flatMap((s) => sectionsMap[s.id]);

  // Deep-fetch & extract crisp executive factual bullets ONLY for genuine surviving signals!
  await enrichCuratedItems(curatedFlat);

  // Strip temporary internal fields before saving JSON
  for (const item of curatedFlat) {
    delete item._rssDescription;
    delete item._extractedTexts;
  }

  // Run the dedicated Senior BM Signal Editor Agent (compresses lines, extracts effective dates & deduplicates official recaps)
  const rawSections = SECTIONS.map((sec) => ({
    ...sec,
    items: sectionsMap[sec.id],
  }));
  const { refinedSections, suppressedItems: postSuppressed, editorStats } = runSeniorBmEditorAgent(rawSections);
  const suppressedItems = [...postSuppressed, ...preSuppressed].slice(0, 25);
  editorStats.suppressedNoise = suppressedItems.length;
  editorStats.timeSavedMinutes = Math.max(2, Math.round(suppressedItems.length * 0.65));
  editorStats.skippedHttpFetches = preSuppressed.length;

  const refinedMap = Object.fromEntries(refinedSections.map((s) => [s.id, s.items]));
  const signalFlat = refinedSections.flatMap((s) => s.items);

  const editionDateKey = formatIstDateKey(referenceNow);
  const editionDateReadable = formatIstReadable(referenceNow);

  const geminiResult = await synthesizeWithGemini(signalFlat, editionDateReadable);
  let synthesisMode = "Senior BM Signal Editor Agent (Zero-Fluff · 18 Direct Official & Tier-1 Sources)";

  if (geminiResult) {
    synthesisMode = `Senior BM Signal Editor + Gemini AI (${process.env.GEMINI_MODEL || "gemini-2.5-flash"})`;
    if (geminiResult.refined && typeof geminiResult.refined === "object") {
      signalFlat.forEach((item, idx) => {
        const ref = geminiResult.refined[String(idx + 1)];
        if (Array.isArray(ref?.keyPoints) && ref.keyPoints.length > 0) {
          item.keyPoints = ref.keyPoints.slice(0, 2);
          item.summary = item.keyPoints[0];
        }
        if (ref?.branchImpact) item.branchImpact = ref.branchImpact;
      });
    }
  }

  // Build Top 5 Executive Pulse strictly from REFINED signals (zero filler!)
  let topFive = [];
  if (geminiResult?.topFive && Array.isArray(geminiResult.topFive) && geminiResult.topFive.length > 0) {
    topFive = geminiResult.topFive.slice(0, 5).map((entry) => {
      const matched = signalFlat[(entry.id || 1) - 1] || signalFlat[0];
      return {
        text: entry.text,
        takeaway: matched?.keyPoints?.[0] || "",
        effectiveTag: matched?.effectiveTag || null,
        section: matched?.section || "rbi_regulatory",
        source: matched?.source || "Verified Source",
        url: matched?.url || "#",
        bankCategories: matched?.bankCategories || [],
      };
    });
  } else {
    const preferredOrder = ["bank_policies", "rbi_regulatory", "interest_rates", "insurance", "finance_macro"];
    const pickedIds = new Set();
    for (const sec of preferredOrder) {
      const first = (refinedMap[sec] || [])[0];
      if (first && !pickedIds.has(first.id)) {
        pickedIds.add(first.id);
        topFive.push({
          text: first.headline,
          takeaway: first.keyPoints?.[0] || "",
          effectiveTag: first.effectiveTag || null,
          section: first.section,
          source: first.source,
          url: first.url,
          bankCategories: first.bankCategories,
        });
      }
    }
    for (const item of signalFlat) {
      if (topFive.length >= 5) break;
      if (!pickedIds.has(item.id)) {
        pickedIds.add(item.id);
        topFive.push({
          text: item.headline,
          takeaway: item.keyPoints?.[0] || "",
          effectiveTag: item.effectiveTag || null,
          section: item.section,
          source: item.source,
          url: item.url,
          bankCategories: item.bankCategories,
        });
      }
    }
  }

  const morningHuddle = geminiResult?.huddle
    ? { title: "Next-Day 9:30 AM Panchkula Branch Huddle Playbook", ...geminiResult.huddle }
    : buildMorningHuddle(refinedMap);

  const pendingDrafts = buildPendingDrafts(refinedMap, morningHuddle, editionDateKey);

  const wordCount = signalFlat.reduce((acc, it) => {
    const kp = (it.keyPoints || []).join(" ");
    return acc + `${it.headline} ${kp} ${it.branchImpact}`.split(/\s+/).length;
  }, 100);
  const readMinutes = Math.max(3, Math.min(7, Math.round(wordCount / 210)));

  const hdfcUpdatesCount = signalFlat.filter((i) => (i.bankCategories || []).includes("HDFC")).length;

  const edition = {
    editionDate: editionDateKey,
    editionLabel: editionDateReadable,
    scheduledSlot: "8:00 PM IST Daily Brief",
    generatedAtUtc: referenceNow.toISOString(),
    profile: {
      name: "Narendra",
      role: "Branch Manager",
      organization: "HDFC Bank",
      location: "Panchkula (Tricity)",
    },
    synthesisMode,
    editorAgent: editorStats,
    stats: {
      totalItems: signalFlat.length,
      suppressedCount: suppressedItems.length,
      estimatedReadMinutes: readMinutes,
      feedsOnline: feedHealth.filter((f) => f.status === "OK").length,
      feedsTotal: feedHealth.length,
      highPriorityCount: signalFlat.filter((i) => i.priority === "HIGH").length,
      rbiCount: (refinedMap.rbi_regulatory || []).length,
      ratesCount: (refinedMap.interest_rates || []).length,
      hdfcCount: hdfcUpdatesCount,
      insuranceCount: (refinedMap.insurance || []).length,
      pendingDraftsCount: pendingDrafts.length,
    },
    topFive,
    morningHuddle,
    pendingDrafts,
    sections: refinedSections,
    suppressedItems,
    sourceHealth: feedHealth.sort((a, b) => b.verified24h - a.verified24h),
  };

  const editionPath = path.join(EDITIONS_DIR, `${editionDateKey}.json`);
  fs.writeFileSync(editionPath, JSON.stringify(edition, null, 2), "utf8");
  fs.writeFileSync(path.join(DATA_DIR, "latest.json"), JSON.stringify(edition, null, 2), "utf8");

  appendAuditEntry({
    action: "EDITOR_AGENT_RUN",
    department: "Senior BM Signal Editor",
    status: "OK",
    detail: `Edition ${editionDateKey}: Kept ${signalFlat.length} crisp net-new signals (~${readMinutes} min read), suppressed ${suppressedItems.length} routine/basic explainers from ${edition.stats.feedsOnline}/${edition.stats.feedsTotal} live feeds.`,
  });

  const files = fs
    .readdirSync(EDITIONS_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse();

  const indexEntries = files
    .map((file) => {
      try {
        const ed = JSON.parse(fs.readFileSync(path.join(EDITIONS_DIR, file), "utf8"));
        return {
          editionDate: ed.editionDate,
          editionLabel: ed.editionLabel,
          totalItems: ed.stats?.totalItems || 0,
          highPriorityCount: ed.stats?.highPriorityCount || 0,
          estimatedReadMinutes: ed.stats?.estimatedReadMinutes || 6,
          topHeadline: ed.topFive?.[0]?.text || "Daily Banking & Insurance Brief",
          synthesisMode: ed.synthesisMode,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  fs.writeFileSync(
    path.join(DATA_DIR, "index.json"),
    JSON.stringify({ updatedAtUtc: referenceNow.toISOString(), editions: indexEntries }, null, 2),
    "utf8"
  );

  return edition;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  console.log("[BM Daily Intel] Fetching & deep-summarizing 18 direct official & Tier-1 BFSI sources...");
  runIntelFetch()
    .then((ed) => {
      console.log(`[BM Daily Intel] Edition ${ed.editionDate} ready!`);
      console.log(`  - Mode: ${ed.synthesisMode}`);
      console.log(`  - Feeds online: ${ed.stats.feedsOnline}/${ed.stats.feedsTotal}`);
      console.log(`  - Curated 24h items: ${ed.stats.totalItems} (~${ed.stats.estimatedReadMinutes} min read)`);
      for (const s of ed.sections) {
        const withBullets = s.items.filter((i) => (i.keyPoints || []).length > 0).length;
        console.log(`  - ${s.shortTitle}: ${s.items.length} items (${withBullets}/${s.items.length} summarized)`);
      }
    })
    .catch((err) => {
      console.error("[BM Daily Intel] Fetch failed:", err);
      process.exitCode = 1;
    });
}
