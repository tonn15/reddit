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

const SUBREDDITS = ["forhire", "slavelabour", "webdev", "smallbusiness", "entrepreneur"];

const KEYWORDS = [
  "besoin d'un site", "besoin de site", "cherche développeur",
  "cherche un développeur", "cherche freelance", "recherche développeur",
  "créer mon site", "création de site", "refaire mon site",
  "besoin d'une landing page",
  "need a website", "need website", "looking for a developer",
  "looking for web developer", "hire a developer", "need a landing page",
  "need a web dev", "website redesign",
];

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const DELAY_BETWEEN_SUBS_MS = 45000;
const SEEN_FILE = path.join(__dirname, "seen.json");

function loadSeen() {
  if (fs.existsSync(SEEN_FILE)) {
    return new Set(JSON.parse(fs.readFileSync(SEEN_FILE, "utf-8")));
  }
  return new Set();
}

function saveSeen(seenSet) {
  const arr = Array.from(seenSet).slice(-2000);
  fs.writeFileSync(SEEN_FILE, JSON.stringify(arr));
}

function matchesKeywords(text) {
  const lower = text.toLowerCase();
  return KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
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

async function parseFeedWithRetry(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await rssParser.parseURL(url);
    } catch (e) {
      if (e.message.includes("429") && attempt < retries) {
        const wait = attempt * 20000;
        console.log(`   Rate-limit, attente ${wait / 1000}s... (tentative ${attempt}/${retries})`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw e;
    }
  }
}

async function checkSubreddit(sub, seen) {
  const url = `https://www.reddit.com/r/${sub}/new/.rss`;

  try {
    const feed = await parseFeedWithRetry(url);
    const items = feed.items || [];

    for (const item of items) {
      const idMatch = (item.link || "").match(/comments\/([a-z0-9]+)\//i);
      const id = idMatch ? idMatch[1] : item.link;
      if (!id || seen.has(id)) continue;

      const title = item.title || "";
      const contentSnippet = (item.contentSnippet || item.content || "").slice(0, 500);
      const fullText = `${title} ${contentSnippet}`;

      if (matchesKeywords(fullText)) {
        const message =
          `🔔 <b>Nouveau lead détecté</b>\n\n` +
          `📍 r/${sub}\n` +
          `📝 <b>${escapeHtml(title)}</b>\n\n` +
          `${escapeHtml(contentSnippet.slice(0, 300))}${contentSnippet.length > 300 ? "..." : ""}\n\n` +
          `🔗 ${item.link}`;

        console.log(`\n✅ [r/${sub}] ${title}`);
        await sendTelegramMessage(message);
      }

      seen.add(id);
    }

    console.log(`  [r/${sub}] ${items.length} posts vérifiés`);
  } catch (e) {
    console.error(`  [r/${sub}] ${e.message}`);
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function runCheck(seen) {
  console.log(`\n--- Vérification ${new Date().toLocaleString("fr-FR")} ---`);
  for (const sub of SUBREDDITS) {
    await checkSubreddit(sub, seen);
    await new Promise((r) => setTimeout(r, DELAY_BETWEEN_SUBS_MS));
  }
  saveSeen(seen);
}

async function main() {
  if (TELEGRAM_BOT_TOKEN === "COLLE_TON_TOKEN_ICI") {
    console.error("⚠️  Configure TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID");
    process.exit(1);
  }

  const seen = loadSeen();
  console.log(`🚀 Lead Watcher démarré. Surveillance de: ${SUBREDDITS.join(", ")}`);
  console.log(`   Vérification toutes les ${POLL_INTERVAL_MS / 60000} minutes.`);

  await sendTelegramMessage("🚀 Lead Watcher démarré, surveillance active.");
  await runCheck(seen);
  setInterval(() => runCheck(seen), POLL_INTERVAL_MS);
}

main();