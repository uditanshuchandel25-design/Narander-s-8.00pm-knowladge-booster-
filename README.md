# BM INTEL — TypeUI Bento Banking Command Centre & Dedicated Signal Editor Agent

Tailored for **Narendra (Branch Manager, HDFC Bank — Panchkula, Tricity)**.  
Combines a **TypeUI Bento modular grid UI/UX** (strict `ui-skills` baseline-ui, accessibility & motion-performance compliant, Warm Cream `#FFF5E6` + Peach `#FAD4C0` + Steel Blue `#80A1C1` + Inter/JetBrains Mono, plus Warm Dark Bento mode) with **1 Dedicated Senior BM Signal Editor Agent** running automatically every day at **8:00 PM IST**.

---

## Core Capabilities
- **1 Dedicated Senior BM Signal Editor Agent (`scripts/executive-editor.js`):**
  - Automatically suppresses beginner explainers, evergreen calculators, routine liquidity ops, non-bank notices, and duplicate media recaps—keeping **only net-new last-24h changes** you actually need to act on.
  - Compresses every surviving item into **1–2 hard-fact lines** (exact bps, rates, ₹ caps, clauses), an **`Effective Date` chip** (`w.e.f. Jan 1, 2027`, `w.e.f. Dec 1`, `Effective Immediately`), and **1 sharp BM Action**.
  - Keeps filtered items in a collapsed **"Filtered Out by Editor Agent"** transparency drawer so nothing is ever hidden blindly.
- **Harvin Command Centre (`Command` Tab):**
  - Dynamic greeting + **`— NEEDS YOUR ATTENTION`** live triage card.
  - **Ask BM Intel** in plain English (`Understand → Department → Verified Facts → Executive Answer / Draft`).
- **Human-in-the-Loop Approvals (`Approvals` Tab):**
  - Auto-drafts your **9:30 AM Panchkula Morning Huddle**, **HDFC Desk Notes**, and **RBI Compliance Alerts**—editable inline before you tap **✓ Approve & Copy for WhatsApp** or **Share**.
- **Archive Search, Audit Log & Mobile PWA (`System` Tab):**
  - Full-text search across past editions, transparent Audit Log of every sync/query/approval, live **8:00 PM IST countdown**, **18/18 Source Health Monitor**, optional **4-digit PIN lock**, and **Android & iPhone Home Screen install**.

---

## Ways to Run Your Dedicated 8:00 PM IST Agent

1. **Interactive Local App (PC + Android/iPhone on same Wi-Fi):**
   Double-click **`start-app.bat`** (runs `server.js` with built-in 8:00 PM IST auto-sync).
2. **Always-On Windows Background Agent (Runs Silently at 8:00 PM IST Daily):**
   Double-click **`install-8pm-agent.bat`** once to register Windows Task `BM_Intel_Daily_8PM_Agent`.
3. **24/7 Cloud Phone Auto-Updates (Works Even When PC Is Off):**
   Push this folder to GitHub → enable `.github/workflows/daily-8pm-intel.yml` (`cron: 30 14 * * *` = 8:00 PM IST) → host `public/` on GitHub Pages / Cloudflare Pages / Netlify → Add to Home Screen on Android & iPhone.
4. **Optional Gemini AI Editor Boost:**
   Copy `.env.example` to `.env` and add `GEMINI_API_KEY=...` for AI-polished executive compression on top of the verified facts.

---

## Automated Testing & Agent Efficiency Benchmarks

Run anytime in PowerShell (use `npm.cmd` when PowerShell blocks `.ps1` shims):

```bash
npm.cmd test             # Unit, structure & live API tests
npm.cmd run test:agents  # 4-agent efficiency benchmark (Harvester, Signal Editor, Router, Approvals)
npm.cmd run test:ui      # Headless Chromium TypeUI Bento + ui-skills UI/UX verification
npm.cmd run test:e2e     # Full interactive mobile & desktop E2E user-journey test
npm.cmd run test:all     # Runs all 4 test suites sequentially
```

