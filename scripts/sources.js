/**
 * Official & Trusted Direct BFSI Source Registry (Zero Opaque Redirects)
 * Tailored for: Narendra — Branch Manager, HDFC Bank (Panchkula)
 */

export const FEEDS = [
  // 1. Official Regulators & Government Sources
  {
    id: "rbi_press",
    name: "RBI Press Releases",
    tier: "Official Regulator",
    url: "https://rbi.org.in/pressreleases_rss.xml",
    defaultSection: "rbi_regulatory",
    requireBfsiFilter: false,
  },
  {
    id: "rbi_notifications",
    name: "RBI Notifications",
    tier: "Official Regulator",
    url: "https://rbi.org.in/notifications_rss.xml",
    defaultSection: "rbi_regulatory",
    requireBfsiFilter: false,
  },
  {
    id: "sebi_official",
    name: "SEBI Official Releases",
    tier: "Official Regulator",
    url: "https://www.sebi.gov.in/sebirss.xml",
    defaultSection: "finance_macro",
    requireBfsiFilter: true,
  },
  {
    id: "pib_india",
    name: "PIB (Govt of India)",
    tier: "Official Government",
    url: "https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3",
    defaultSection: "finance_macro",
    requireBfsiFilter: true,
  },

  // 2. Direct Tier-1 Indian Banking, Finance, Rates & Insurance Feeds
  {
    id: "et_banking",
    name: "Economic Times — Banking & Finance",
    tier: "Tier-1 Financial Media",
    url: "https://economictimes.indiatimes.com/industry/banking/finance/rssfeeds/13358259.cms",
    defaultSection: null,
    requireBfsiFilter: false,
  },
  {
    id: "cnbc_finance",
    name: "CNBC-TV18 — Finance & Banking",
    tier: "Tier-1 Financial Media",
    url: "https://www.cnbctv18.com/commonfeeds/v1/cne/rss/finance.xml",
    defaultSection: null,
    requireBfsiFilter: true,
  },
  {
    id: "cnbc_pf",
    name: "CNBC-TV18 — Personal Finance & Insurance",
    tier: "Tier-1 Financial Media",
    url: "https://www.cnbctv18.com/commonfeeds/v1/cne/rss/personal-finance.xml",
    defaultSection: null,
    requireBfsiFilter: true,
  },
  {
    id: "cnbc_econ",
    name: "CNBC-TV18 — Economy & RBI",
    tier: "Tier-1 Financial Media",
    url: "https://www.cnbctv18.com/commonfeeds/v1/cne/rss/economy.xml",
    defaultSection: null,
    requireBfsiFilter: true,
  },
  {
    id: "bl_money",
    name: "The Hindu BusinessLine — Money & Banking",
    tier: "Tier-1 Financial Media",
    url: "https://www.thehindubusinessline.com/money-and-banking/feeder/default.rss",
    defaultSection: null,
    requireBfsiFilter: false,
  },
  {
    id: "bs_banking",
    name: "Business Standard — Banking",
    tier: "Tier-1 Financial Media",
    url: "https://www.business-standard.com/rss/industry/banking-21703.rss",
    defaultSection: null,
    requireBfsiFilter: false,
  },
  {
    id: "bs_finance",
    name: "Business Standard — Finance",
    tier: "Tier-1 Financial Media",
    url: "https://www.business-standard.com/rss/finance-103.rss",
    defaultSection: null,
    requireBfsiFilter: true,
  },
  {
    id: "bs_insurance",
    name: "Business Standard — Insurance",
    tier: "Tier-1 Financial Media",
    url: "https://www.business-standard.com/rss/finance/insurance-10307.rss",
    defaultSection: "insurance",
    requireBfsiFilter: false,
  },
  {
    id: "mint_money",
    name: "Livemint — Money & Personal Finance",
    tier: "Tier-1 Financial Media",
    url: "https://www.livemint.com/rss/money",
    defaultSection: null,
    requireBfsiFilter: true,
  },
  {
    id: "mint_insurance",
    name: "Livemint — Insurance",
    tier: "Tier-1 Financial Media",
    url: "https://www.livemint.com/rss/insurance",
    defaultSection: "insurance",
    requireBfsiFilter: false,
  },
  {
    id: "mint_economy",
    name: "Livemint — Economy & Policy",
    tier: "Tier-1 Financial Media",
    url: "https://www.livemint.com/rss/economy",
    defaultSection: null,
    requireBfsiFilter: true,
  },
  {
    id: "mc_business",
    name: "Moneycontrol — Business & BFSI",
    tier: "Tier-1 Financial Media",
    url: "https://www.moneycontrol.com/rss/business.xml",
    defaultSection: null,
    requireBfsiFilter: true,
  },
  {
    id: "ndtv_profit",
    name: "NDTV Profit — Markets & Banking",
    tier: "Tier-1 Financial Media",
    url: "https://feeds.feedburner.com/ndtvprofit-latest",
    defaultSection: null,
    requireBfsiFilter: true,
  },

  // 3. International Banking & Global Central Banks
  {
    id: "cnbc_global",
    name: "CNBC Global — Central Banks & Intl Finance",
    tier: "International Trusted Media",
    url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664",
    defaultSection: "finance_macro",
    requireBfsiFilter: true,
  },
];

export const SECTIONS = [
  {
    id: "rbi_regulatory",
    title: "RBI Guidelines & Regulatory Alerts",
    shortTitle: "RBI & Regulatory",
    badge: "COMPLIANCE",
    description: "Circulars, KYC/AML, lending norms, audit/compliance directives, Ombudsman & regulatory penalties.",
  },
  {
    id: "interest_rates",
    title: "Interest Rates & Pricing Radar",
    shortTitle: "Interest Rates",
    badge: "PRICING",
    description: "Repo/MCLR/RLLR revisions, FD/RD/Savings rates, Home/Auto/MSME loan rates & Govt Small Savings.",
  },
  {
    id: "bank_policies",
    title: "Bank Policies, Charges & Schemes",
    shortTitle: "Bank Policies",
    badge: "PRODUCTS",
    description: "AMB/AQB updates, service charges, credit/debit card changes, salary/govt/current account launches.",
  },
  {
    id: "insurance",
    title: "Insurance & Bancassurance Desk (TPP)",
    shortTitle: "Insurance (TPP)",
    badge: "LIFE · TERM · HEALTH · NON-LIFE",
    description: "Life, Term Plans, Health Insurance & Non-Life/General updates from IRDAI, HDFC Life, HDFC ERGO, LIC & peers.",
  },
  {
    id: "finance_macro",
    title: "Finance, Payments & International Banking",
    shortTitle: "Finance & Global",
    badge: "MACRO · GLOBAL",
    description: "NPCI/UPI, SEBI/Mutual Funds, banking liquidity, foreign banks (HSBC/StanChart/DBS) & global central banks.",
  },
];

export const BANK_CATEGORIES = [
  "HDFC",
  "Private",
  "PSU/Govt",
  "Semi-Govt",
  "International",
];
