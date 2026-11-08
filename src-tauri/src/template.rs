use std::path::Path;

use crate::error::AppResult;
use crate::vault::atomic_write;

const WORKER_MANIFEST: &str = r#"{
  "schema": 2,
  "kind": "shared-worker",
  "runtime": "bun",
  "entry": "src/index.ts",
  "min_runtime": "1.1.0"
}
"#;

const PACKAGE_JSON: &str = r#"{
  "name": "zenode-bot",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "bun run src/index.ts"
  },
  "dependencies": {
    "discord.js": "^14.27.0",
    "mongoose": "^9.9.1",
    "dotenv": "^17.4.2"
  }
}
"#;

const TSCONFIG: &str = r#"{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["bun-types"]
  },
  "include": ["src"]
}
"#;

const GITIGNORE: &str = "node_modules/\nruntime.json\n*.log\n.env\n";

const README: &str = r#"# Zenode Worker

Ce dossier contient **le code partagé** exécuté par **Zenode Host** avec le
runtime Bun épinglé fourni par l'application.

## Un seul code, une seule base

- Tous les clusters classiques utilisent ce même code.
- Les clusters à code modifié disposent de leur propre fork dans
  `cluster-code/<cluster_id>`.
- Chaque bot possède sa configuration dans `bots/<bot_id>/zenode.bot.json`
  et son état (`runtime.json`) dans `bots/<bot_id>`.
- Tous les bots partagent **une seule base MongoDB**. Les documents sont
  isolés par le champ `botId`. La connexion est configurée via les
  variables d'environnement `MONGODB_URI` et `MONGODB_DB`.

## Architecture (Core en API)

Ce worker reçoit ses ordres du Core Zenode via API. Le Core n'est pas
installé localement — il tourne sur l'infrastructure Zenode.

- `src/index.ts` — point d'entrée du worker (modifiable)
- `zenode.worker.json` — manifeste lu par Zenode Host (ne pas supprimer)

## Commandes

```bash
bun install
bun run src/index.ts
```

Le jeton Discord n'est **jamais** écrit dans ce dossier : Zenode Host le
fournit au processus via la variable d'environnement `DISCORD_TOKEN`.

La création de bots se fait sur le site web Zenode (Core).
"#;

const INDEX_TS: &str = r#"import { Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// ---------- Configuration ----------

const token = process.env.DISCORD_TOKEN
if (!token) {
  console.error('[bot] DISCORD_TOKEN manquant — lancez le bot depuis Zenode Host.')
  process.exit(1)
}

const botId = process.env.ZENODE_BOT_ID ?? 'local'
const botName = process.env.BOT_NAME ?? 'Zenode Bot'
const hostId = process.env.ZENODE_HOST_ID ?? 'local'
// Le code est partagé entre plusieurs bots : l'état propre à chaque bot
// (runtime.json, config) vit dans ZENODE_BOT_DIR, jamais dans le code.
const botDir = process.env.ZENODE_BOT_DIR ?? process.cwd()
const startedAt = Date.now()

// ---------- MongoDB (base partagée, isolation par botId) ----------

let db: typeof import('mongoose') | null = null
const mongoUri = process.env.MONGODB_URI
const mongoDb = process.env.MONGODB_DB ?? 'znd'

if (mongoUri) {
  try {
    const mongoose = await import('mongoose')
    await mongoose.default.connect(mongoUri, { dbName: mongoDb })
    db = mongoose.default
    console.log(`[bot] MongoDB connecté (base ${mongoDb}, botId=${botId})`)
  } catch (error) {
    console.warn('[bot] MongoDB non disponible:', (error as Error).message)
  }
}

// ---------- Client Discord ----------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
})

async function publishRuntime(extra: Record<string, unknown> = {}) {
  const payload = {
    bot_id: botId,
    host_id: hostId,
    bot_name: botName,
    discord_ready: client.isReady(),
    uptime_ms: Date.now() - startedAt,
    pid: process.pid,
    updated_at: new Date().toISOString(),
    ...extra,
  }
  try {
    await writeFile(join(botDir, 'runtime.json'), JSON.stringify(payload), { mode: 0o600 })
  } catch (error) {
    console.warn('[bot] runtime.json non écrit:', (error as Error).message)
  }
}

client.once(Events.ClientReady, async (ready) => {
  console.log(`[bot] connecté en tant que ${ready.user.tag} (${ready.user.id})`)
  await publishRuntime({ discord_user: ready.user.tag })

  const ping = new SlashCommandBuilder().setName('ping').setDescription('Vérifier que le bot répond')
  try {
    const rest = new REST({ version: '10' }).setToken(token)
    await rest.put(Routes.applicationCommands(ready.user.id), { body: [ping.toJSON()] })
    console.log('[bot] commande /ping enregistrée')
  } catch (error) {
    console.warn('[bot] enregistrement des commandes:', (error as Error).message)
  }
})

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return
  if (interaction.commandName === 'ping') {
    const latency = Math.max(0, Date.now() - interaction.createdTimestamp)
    await interaction.reply({ content: `Pong — ${latency} ms · uptime ${Math.round((Date.now() - startedAt) / 1000)} s`, ephemeral: true })
  }
})

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return
  const prefix = process.env.PREFIX ?? '!'
  if (message.content === `${prefix}ping`) {
    await message.reply('Pong.')
  }
})

client.on(Events.Error, (error) => console.error('[bot] erreur Discord:', error.message))
client.on(Events.Warn, (warning) => console.warn('[bot] avertissement:', warning))

const heartbeat = setInterval(() => void publishRuntime(), 5_000)
heartbeat.unref?.()

async function shutdown(signal: string) {
  console.log(`[bot] arrêt (${signal})`)
  clearInterval(heartbeat)
  await publishRuntime({ discord_ready: false, stopping: true }).catch(() => undefined)
  if (db) {
    await db.disconnect().catch(() => undefined)
  }
  await client.destroy().catch(() => undefined)
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

client.login(token).catch((error) => {
  const text = error instanceof Error ? error.message : String(error)
  if (/disallowed intents|privileged/i.test(text)) {
    console.error(`Privileged Intents error: ${text}. Activez Message Content, Server Members et Presence dans le portail Discord.`)
  } else if (/invalid token|unauthorized/i.test(text)) {
    console.error(`Invalid Discord token (unauthorized): ${text}`)
  } else {
    console.error(`[bot] échec de connexion: ${text}`)
  }
  process.exit(1)
})
"#;

const ENV_EXAMPLE: &str = r#"# ---------- Zenode Bot — Variables d'environnement ----------
# Ce fichier est un modèle. Le jeton Discord est fourni par Zenode Host
# via DISCORD_TOKEN — ne le mettez pas ici.

# Base de données MongoDB partagée entre tous les bots.
# Les documents sont isolés par le champ botId.
# MONGODB_URI=mongodb://localhost:27017/bot-v2
# MONGODB_DB=znd

# Préfixe des commandes texte (défaut : !)
# PREFIX=!

# La création de bots se fait sur le site web Zenode (Core).
"#;

/// Configuration d'un bot. Le code reste partagé : ce fichier vit dans le
/// dossier du bot et ne contient jamais de secret.
#[derive(Debug, serde::Serialize)]
pub struct BotConfig<'a> {
    pub schema: u32,
    pub bot_id: &'a str,
    pub name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cluster_name: Option<&'a str>,
    pub code_variant: &'a str,
    pub entry: &'a str,
}

/// Installe le code partagé (worker classique) dans `dir` sans écraser une
/// modification existante. Cette fonction est idempotente.
pub fn ensure_worker_code(dir: &Path) -> AppResult<()> {
    std::fs::create_dir_all(dir.join("src"))?;
    write_if_missing(&dir.join("zenode.worker.json"), WORKER_MANIFEST.as_bytes())?;
    write_if_missing(&dir.join("package.json"), PACKAGE_JSON.as_bytes())?;
    write_if_missing(&dir.join("tsconfig.json"), TSCONFIG.as_bytes())?;
    write_if_missing(&dir.join(".gitignore"), GITIGNORE.as_bytes())?;
    write_if_missing(&dir.join("README.md"), README.as_bytes())?;
    write_if_missing(&dir.join("src/index.ts"), INDEX_TS.as_bytes())?;
    write_if_missing(&dir.join(".env.example"), ENV_EXAMPLE.as_bytes())?;
    Ok(())
}

/// Écrit la configuration d'un bot dans son dossier.
pub fn write_bot_config(dir: &Path, config: &BotConfig<'_>) -> AppResult<()> {
    std::fs::create_dir_all(dir)?;
    let payload = serde_json::to_vec_pretty(config)
        .map_err(|_| crate::error::err("Configuration de bot invalide."))?;
    atomic_write(&dir.join("zenode.bot.json"), &payload, false)?;
    Ok(())
}

fn write_if_missing(path: &Path, contents: &[u8]) -> AppResult<()> {
    if path.exists() {
        return Ok(());
    }
    atomic_write(path, contents, false)
}
