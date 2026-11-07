use std::path::Path;

use crate::error::AppResult;
use crate::vault::atomic_write;

const MANIFEST: &str = r#"{
  "schema": 1,
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
    "discord.js": "^14.27.0"
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

const README: &str = r#"# Bot Zenode

Ce dossier contient le code source de votre bot. Il est exécuté par
**Zenode Host** avec le runtime Bun épinglé fourni par l'application.

## Structure

- `src/index.ts` — point d'entrée du bot (modifiable)
- `zenode.bot.json` — manifeste lu par Zenode Host (ne pas supprimer)
- `runtime.json` — état publié par le bot (généré, ne pas éditer)

## Commandes

```bash
bun install
bun run src/index.ts
```

Le jeton Discord n'est **jamais** écrit dans ce dossier : Zenode Host le
fournit au processus via la variable d'environnement `DISCORD_TOKEN`.
"#;

const INDEX_TS: &str = r#"import { Client, Events, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js'
import { writeFile } from 'node:fs/promises'

const token = process.env.DISCORD_TOKEN
if (!token) {
  console.error('[bot] DISCORD_TOKEN manquant — lancez le bot depuis Zenode Host.')
  process.exit(1)
}

const botId = process.env.ZENODE_BOT_ID ?? 'local'
const botName = process.env.BOT_NAME ?? 'Zenode Bot'
const hostId = process.env.ZENODE_HOST_ID ?? 'local'
const startedAt = Date.now()

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
    await writeFile('runtime.json', JSON.stringify(payload), { mode: 0o600 })
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
  await client.destroy().catch(() => undefined)
  process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('unhandledRejection', (reason) => console.error('[bot] promesse rejetée:', reason))

console.log(`[bot] démarrage de ${botName} (${botId})`)
await client.login(token)
"#;

/// Écrit le squelette d'un bot s'il n'existe pas encore. Ne remplace jamais un
/// fichier existant : l'utilisateur peut éditer son code sans risque.
pub fn ensure_template(dir: &Path, name: &str) -> AppResult<()> {
    std::fs::create_dir_all(dir.join("src"))?;
    write_if_missing(&dir.join("zenode.bot.json"), MANIFEST.as_bytes())?;
    write_if_missing(&dir.join("package.json"), PACKAGE_JSON.as_bytes())?;
    write_if_missing(&dir.join("tsconfig.json"), TSCONFIG.as_bytes())?;
    write_if_missing(&dir.join(".gitignore"), GITIGNORE.as_bytes())?;
    let readme = README.replace("Bot Zenode", name);
    write_if_missing(&dir.join("README.md"), readme.as_bytes())?;
    write_if_missing(&dir.join("src/index.ts"), INDEX_TS.as_bytes())?;
    Ok(())
}

fn write_if_missing(path: &Path, contents: &[u8]) -> AppResult<()> {
    if path.exists() {
        return Ok(());
    }
    atomic_write(path, contents, false)
}
