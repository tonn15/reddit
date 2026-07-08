# Lead Watcher — Notif Telegram instantanée

Surveille Reddit (r/forhire, r/webdev, etc.) 24/24 et t'envoie une notif Telegram
dès qu'un post correspond à tes mots-clés ("besoin d'un site", "need a website", etc.).

Aucune dépendance npm nécessaire — utilise `fetch` natif de Node 18+.

## 1. Créer ton bot Telegram (5 minutes, gratuit)

1. Ouvre Telegram, cherche **@BotFather**
2. Envoie `/newbot`
3. Donne un nom (ex: "Lead Watcher") et un username unique (doit finir par `bot`, ex: `antonio_lead_watcher_bot`)
4. BotFather te donne un **token** du genre `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ` → note-le

## 2. Récupérer ton Chat ID

1. Cherche ton bot sur Telegram (par son username) et envoie-lui n'importe quel message (ex: "salut")
2. Ouvre dans ton navigateur (remplace TOKEN par le tien) :
   ```
   https://api.telegram.org/botTOKEN/getUpdates
   ```
3. Tu verras un JSON avec `"chat":{"id": 123456789, ...}` → c'est ton **chat_id**

## 3. Configurer

Ouvre `watcher.js` et remplace directement dans le fichier :

```js
const TELEGRAM_BOT_TOKEN = "TON_TOKEN_ICI";
const TELEGRAM_CHAT_ID = "TON_CHAT_ID_ICI";
```

Ou (plus propre) définis des variables d'environnement avant de lancer :

**Windows (cmd):**
```cmd
set TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ
set TELEGRAM_CHAT_ID=123456789
node watcher.js
```

**Windows (PowerShell):**
```powershell
$env:TELEGRAM_BOT_TOKEN="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
$env:TELEGRAM_CHAT_ID="123456789"
node watcher.js
```

## 4. Lancer

```bash
node watcher.js
```

Tu devrais recevoir immédiatement un message "🚀 Lead Watcher démarré" sur Telegram,
puis une notif à chaque nouveau post matché, vérifié toutes les 2 minutes.

## 5. Le faire tourner en continu (24/24)

Sur ton PC, si tu fermes le terminal, le script s'arrête. Options :

**Option simple — laisser un terminal ouvert** (marche mais pas pratique si tu éteins le PC)

**Option recommandée — PM2** (garde le script actif en arrière-plan, redémarre auto si crash) :
```bash
npm install -g pm2
pm2 start watcher.js --name lead-watcher
pm2 save
pm2 startup   # pour qu'il redémarre avec Windows
```

**Option la plus fiable — petit serveur VPS** (5$/mois genre DigitalOcean/OVH) si tu veux
que ça tourne même PC éteint. Dis-moi si tu veux qu'on configure ça.

## Personnaliser

- **Ajouter des subreddits** : édite le tableau `SUBREDDITS` dans `watcher.js`
- **Ajouter des mots-clés** : édite le tableau `KEYWORDS`
- **Changer la fréquence** : `POLL_INTERVAL_MS` (actuellement 2 min — ne descends pas
  sous 30s pour éviter le rate-limit de l'API Reddit publique)

## Fichier seen.json

Le script garde une trace des posts déjà vus dans `seen.json` pour ne jamais te
renotifier deux fois le même post. Ne le supprime pas sauf si tu veux repartir de zéro
(tu recevrais alors une notif pour tous les posts récents matchés).

## Limites actuelles

- Couvre Reddit uniquement pour l'instant (API publique, zéro risque de ban)
- Twitter/X, Facebook, Upwork/Malt ne sont pas inclus — voir la section
  "EXTENSIONS POSSIBLES" en bas de `watcher.js` pour pourquoi et comment les ajouter
