const http = require("http");
const fs = require("fs");
const path = require("path");
const Parser = require("rss-parser");

const rssParser = new Parser({
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
    Accept: "application/rss+xml, application/xml, text/xml",
  },
});

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8315625996:AAHzoSzUBgyzU7OWOnUZWySo9DtFrTaqD2I";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "6392300598";

// ==================== SOURCES ====================

const SUBREDDITS = [
  "FreelanceProgramming", "forhire", "freelance", "webdev", "smallbusiness",
  "webdevjobs", "DesignJobs", "frontend", "web_design", "Wordpress",
  "shopify", "reactjs", "nextjs", "webflow", "squarespace",
];

// Colle ici tes URLs de flux RSS Google Alerts (voir README pour les générer).
// Exemple: "https://www.google.com/alerts/feeds/XXXXXXXXXXXXX/XXXXXXXXXXXXX"
const GOOGLE_ALERTS_FEEDS = [
  // "https://www.google.com/alerts/feeds/TON_ID/TON_AUTRE_ID",
];

const HN_ENABLED = true; // Hacker New — API publique, pas de clé nécessaire

// ===================================================

const KEYWORDS = [
  // Français
  "besoin d'un site", "besoin de site", "cherche développeur",
  "cherche un développeur", "cherche freelance", "recherche développeur",
  "créer mon site", "création de site", "refaire mon site",
  "besoin d'une landing page",
  // Anglais
  "need a website", "need website", "looking for a developer",
  "looking for web developer", "hire a developer", "need a landing page",
  "need a web dev", "website redesign",
];

const POLL_INTERVAL_MS = 12 * 60 * 1000;
const DELAY_BETWEEN_SUBS_MS = 120 * 1000;

const SEEN_FILE = path.join(__dirname, "seen.json");
const STATE_FILE = path.join(__dirname, "state.json");

const MAX_POSTS_PER_SUB = 5;

// ==================================================

function loadSeen() {
  if (fs.existsSync(SEEN_FILE)) {
    return new Set(JSON.parse(fs.readFileSync(SEEN_FILE, "utf-8")));
  }
  return new Set();
}

function saveSeen(seenSet) {
  const arr = Array.from(seenSet).slice(-5000);
  fs.writeFileSync(SEEN_FILE, JSON.stringify(arr));
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  }
  return { lastPostDates: {} };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function matchesKeywords(text) {
  const lower = text.toLowerCase();
  return KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

function escapeHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

async function sendTelegramMessage(text) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    if (!data.ok) console.error("Erreur Telegram:", data);
  } catch (e) {
    console.error("Erreur envoi Telegram:", e.message);
  }
}

async function notifyLead({ source, title, snippet, link }) {
  const message =
    `🔔 <b>Nouveau lead détecté</b>\n\n` +
    `📍 ${source}\n` +
    `📝 <b>${escapeHtml(title)}</b>\n\n` +
    `${escapeHtml((snippet || "").slice(0, 300))}${(snippet || "").length > 300 ? "..." : ""}\n\n` +
    `🔗 ${link}`;

  console.log(`\n✅ [${source}] ${title}`);
  await sendTelegramMessage(message);
}

// ==================== REDDIT ====================

async function parseFeedWithRetry(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await rssParser.parseURL(url);
    } catch (e) {
      if (e.message.includes("429") && attempt < retries) {
        const wait = attempt * 30000;
        console.log(`   Rate-limit, attente ${wait / 1000}s... (tentative ${attempt}/${retries})`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
}

async function checkSubreddit(sub, seen, state) {
  const url = `https://www.reddit.com/r/${sub}/new/.rss`;
  const lastDates = state.lastPostDates || {};

  try {
    const feed = await parseFeedWithRetry(url);
    const items = feed.items || [];

    const lastDate = lastDates[sub] ? new Date(lastDates[sub]).getTime() : 0;
    let newestDate = lastDate;
    let checked = 0;

    for (const item of items) {
      const itemDate = item.isoDate ? new Date(item.isoDate).getTime() : 0;
      if (itemDate && itemDate > newestDate) {
        newestDate = itemDate;
      }

      if (itemDate && itemDate <= lastDate) continue;

      if (checked >= MAX_POSTS_PER_SUB) {
        newestDate = itemDate || newestDate;
        continue;
      }

      const idMatch = (item.link || "").match(/comments\/([a-z0-9]+)\//i);
      const rawId = idMatch ? idMatch[1] : item.link;
      const id = `reddit_${rawId}`;
      if (!rawId || seen.has(id)) continue;

      checked++;

      const title = item.title || "";
      const bodyText = stripHtml(item.content || "") || item.contentSnippet || "";
      const fullText = `${title} ${bodyText}`;

      if (matchesKeywords(fullText)) {
        await notifyLead({
          source: `r/${sub}`,
          title,
          snippet: bodyText || title,
          link: item.link,
        });
      }

      seen.add(id);
    }

    if (newestDate > lastDate) {
      lastDates[sub] = new Date(newestDate).toISOString();
    }

    console.log(`  [r/${sub}] ${checked} nouveau${checked > 1 ? "x" : ""} post${checked > 1 ? "s" : ""} vérifié${checked > 1 ? "s" : ""}`);
  } catch (e) {
    console.error(`  [r/${sub}] ${e.message}`);
  }
}

// ==================== GOOGLE ALERTS (RSS générique) ====================

async function checkGoogleAlertFeed(feedUrl, seen) {
  try {
    const feed = await rssParser.parseURL(feedUrl);
    const items = feed.items || [];
    const feedLabel = feed.title || "Google Alert";

    for (const item of items) {
      const rawId = item.guid || item.link;
      const id = `galert_${rawId}`;
      if (!rawId || seen.has(id)) continue;

      const title = stripHtml(item.title || "");
      const bodyText = stripHtml(item.contentSnippet || item.content || "");

      // Google Alerts pré-filtre déjà par mot-clé au moment de la création
      // de l'alerte, donc on notifie systématiquement les nouveaux résultats
      // (pas de re-filtrage par KEYWORDS ici).
      await notifyLead({
        source: `🔎 ${feedLabel}`,
        title,
        snippet: bodyText,
        link: item.link,
      });

      seen.add(id);
    }

    console.log(`  [Google Alert: ${feedLabel}] ${items.length} résultats vérifiés`);
  } catch (e) {
    console.error(`  [Google Alert ${feedUrl}] ${e.message}`);
  }
}

// ==================== HACKER NEWS ====================
// API Algolia publique, pas de clé, rate-limit très permissif (pas Reddit-like)

async function checkHackerNews(seen) {
  const url = "https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=100";

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.error(`  [HackerNews] HTTP ${res.status}`);
      return;
    }
    const data = await res.json();
    const hits = data.hits || [];

    for (const hit of hits) {
      const rawId = hit.objectID;
      const id = `hn_${rawId}`;
      if (!rawId || seen.has(id)) continue;

      const title = hit.title || hit.story_title || "";
      const bodyText = stripHtml(hit.story_text || hit.comment_text || "");
      const fullText = `${title} ${bodyText}`;

      if (matchesKeywords(fullText)) {
        const link = hit.url || `https://news.ycombinator.com/item?id=${rawId}`;
        await notifyLead({
          source: "Hacker News",
          title,
          snippet: bodyText || title,
          link,
        });
      }

      seen.add(id);
    }

    console.log(`  [HackerNews] ${hits.length} posts vérifiés`);
  } catch (e) {
    console.error(`  [HackerNews] ${e.message}`);
  }
}

// ==================== BOUCLE PRINCIPALE ====================

async function runCheck(seen, state) {
  console.log(`\n--- Vérification ${new Date().toLocaleString("fr-FR")} ---`);

  for (const sub of SUBREDDITS) {
    await checkSubreddit(sub, seen, state);
    await new Promise((r) => setTimeout(r, DELAY_BETWEEN_SUBS_MS));
  }

  if (HN_ENABLED) {
    await checkHackerNews(seen);
  }

  for (const feedUrl of GOOGLE_ALERTS_FEEDS) {
    await checkGoogleAlertFeed(feedUrl, seen);
  }

  saveSeen(seen);
  saveState(state);
}

// ==================== ANTI-SLEEP RENDER ====================

let selfPingFailCount = 0;

async function selfPing() {
  const url = process.env.RENDER_URL || process.env.RENDER_EXTERNAL_URL;
  if (!url) return;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    console.log(`   Anti-sleep — ping OK (${res.status})`);
    selfPingFailCount = 0;
  } catch (e) {
    selfPingFailCount++;
    console.log(`   ❌ Anti-sleep — ping échoué: ${e.message}`);
    if (selfPingFailCount >= 2) {
      await sendTelegramMessage(`⚠️ Anti-sleep — ${selfPingFailCount} échecs consécutifs. Vérifie le service Render.`);
    }
  }
}

// ==================== MAIN ====================

async function main() {
  if (TELEGRAM_BOT_TOKEN === "COLLE_TON_TOKEN_ICI") {
    console.error("⚠️  Configure TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID");
    process.exit(1);
  }

  const PORT = process.env.PORT || 3000;
  http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Lead Watcher actif ✅");
  }).listen(PORT, () => {
    console.log(`   Serveur HTTP factice à l'écoute sur le port ${PORT} (pour Render)`);
  });

  const seen = loadSeen();
  const state = loadState();

  const sourcesActives = [
    `Reddit (${SUBREDDITS.length} subs)`,
    HN_ENABLED ? "Hacker News" : null,
    GOOGLE_ALERTS_FEEDS.length ? `Google Alerts (${GOOGLE_ALERTS_FEEDS.length} flux)` : null,
  ].filter(Boolean).join(", ");

  console.log(`🚀 Lead Watcher démarré. Sources: ${sourcesActives}`);
  console.log(`   Vérification toutes les ${POLL_INTERVAL_MS / 60000} minutes.`);

  if (process.env.RENDER_URL || process.env.RENDER_EXTERNAL_URL) {
    setInterval(selfPing, 10 * 60 * 1000);
    console.log(`   Anti-sleep actif : ping toutes les 10 min (notif Telegram seulement si échec répété)`);
  } else {
    console.log(`   Anti-sleep désactivé. Définis RENDER_URL ou utilise cron-job.org`);
  }

  await sendTelegramMessage(`🚀 Lead Watcher démarré.\nSources actives : ${sourcesActives}`);
  await runCheck(seen, state);
  setInterval(() => runCheck(seen, state), POLL_INTERVAL_MS);
}

main();