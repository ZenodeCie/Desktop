# Zenode Host

Application desktop (Windows, macOS, Linux) pour héberger des bots Discord
TypeScript sur sa propre machine, seul ou au sein d'un **VM Worker** Zenode.

Construite avec **Tauri v2**, **Rust** et **React 18**. L'interface reprend la
charte de [zenode.fr](https://zenode.fr).

> L'application est un support **d'administration et de création de VM Workers**.
> Les bots se créent sur [zenode.fr](https://zenode.fr) : l'application les
> reçoit depuis le Core via des affectations scellées.

## Fonctionnalités

- **Installation minimale** : un runtime Bun épinglé est téléchargé à la
  demande, vérifié par SHA-256 puis extrait dans le dossier de données de
  l'application. Aucun Node.js ni Bun global n'est requis.
- **Un processus par bot** : démarrage, arrêt, redémarrage (politique et
  nombre maximal de tentatives), arrêt automatique des arbres de processus.
- **Un seul code, une seule base** : les clusters classiques partagent le code
  `<données app>/worker` ; les clusters à code modifié disposent de leur fork
  isolé dans `<données app>/cluster-code/<cluster_id>`. Chaque bot a sa
  configuration (`bots/<id>/zenode.bot.json`) et son état (`runtime.json`),
  mais tous partagent la même base MongoDB, isolée par `botId`.
- **Logs en direct**, métriques CPU/RAM, détection de la connexion Discord.
- **Éditeur Monaco intégré** (embarqué localement, aucun CDN), avec boutons
  « Ouvrir dans VS Code / Cursor ».
- **Coffre chiffré** : jetons Discord, jetons Core et clé privée d'hôte sont
  chiffrés en AES-256-GCM ; la clé maître vit dans le trousseau du système.
- **VM Workers** : liaison de l'application au compte Zenode, heartbeats,
  affectations de bots, clusters privés (invitation) et publics (catalogue et
  modération), reprise après panne.
- **Clusters de particuliers** : un VM Worker public appartenant à un
  particulier apparaît sur zenode.fr comme les autres clusters, avec un
  avertissement explicite « cluster appartenant à un particulier, hors
  responsabilité Zenode ».
- **Backups** : pour un cluster de particulier **public** uniquement, une
  sauvegarde roulante des données est produite toutes les 48 h ; la nouvelle
  écrase l'ancienne. Aucune sauvegarde pour un cluster privé ou officiel.
- **Code modifié séparé** : les clusters à code modifié sont listés et filtrés
  séparément des clusters classiques dans l'application et sur le site.
- **Auto-start** au login, icône de barre des tâches, démarrage en arrière-plan
  à la fermeture de la fenêtre.
- **Mises à jour** : l'application interroge Zenode et ouvre la page de
  téléchargement de la nouvelle version.

## Développement

Prérequis : Rust stable, Node.js 20+ et les dépendances système de Tauri v2
(voir <https://v2.tauri.app/start/prerequisites/>).

```bash
npm install
npm run tauri:dev     # fenêtre Tauri + Vite en mode développement
npm run typecheck     # vérification TypeScript
npm run build         # bundle frontend dans dist/
npm run tauri:build   # application et installeurs
```

Vérifications Rust :

```bash
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

## Architecture

```text
src/                     Frontend React (pages, composants, contexte)
src-tauri/src/
  lib.rs                 Démarrage, tray, boucles de surveillance et de sync
  commands.rs            Commandes Tauri exposées au frontend
  bot.rs                 Cycle de vie des bots, logs, fichiers, affectations
  template.rs            Code partagé du worker et configuration par bot
  runtime.rs             Téléchargement et vérification de Bun
  vault.rs               Coffre AES-256-GCM + clé dans le trousseau
  crypto.rs              Ouverture des secrets scellés (X25519 + HKDF + AES-GCM)
  limits.rs              Limites mémoire/CPU best-effort par processus
  core.rs                Liaison, jetons, heartbeat, clusters, catalogue
  models.rs              Modèles sérialisés (état local, API)
  paths.rs               Chemins de données et validations anti-traversée
```

L'application ne parle au serveur que par HTTPS (`https://zenode.fr`). Le HTTP
n'est accepté que pour `127.0.0.1`/`localhost` en développement.

### Cycle d'un bot

1. Le code du worker est **partagé** : `<données app>/worker` pour les clusters
   classiques, `<données app>/cluster-code/<cluster_id>` pour un cluster à code
   modifié. Le dossier `<données app>/bots/<id>/` ne contient que la
   configuration du bot (`zenode.bot.json`) et son état d'exécution.
2. Le jeton Discord n'est **jamais** écrit dans ces fichiers : il est lu dans le
   coffre et injecté au processus via `DISCORD_TOKEN` / `BOT_TOKEN`. Le bot
   reçoit `ZENODE_BOT_ID`, `ZENODE_BOT_DIR`, `ZENODE_CONFIG` et
   `ZENODE_CODE_VARIANT`.
3. Le processus est lancé avec Bun depuis le dossier de code, dans un groupe de
   processus dédié, avec des limites best-effort (mémoire, fichiers ouverts,
   CPU).
4. `stdout`/`stderr` sont redactés (les jetons ressemblant à un token Discord
   sont masqués) puis diffusés au frontend et écrits dans un fichier de log
   rotationné.

### Clusters

- La liaison se fait par code d'appairage : l'application affiche un code, le
  site l'approuve, puis l'application reçoit des jetons opaques à durée limitée
  (accès court, rafraîchissement long).
- À chaque heartbeat, le serveur peut renvoyer une affectation de bot. Le jeton
  Discord nécessaire est **scellé** pour la clé publique X25519 de l'hôte :
  seul cet hôte peut l'ouvrir. Le secret n'est jamais renvoyé au frontend.
- Les clusters privés fonctionnent par invitation ; les clusters publics sont
  listés dans un catalogue et modérés côté serveur.
- Un cluster créé par un utilisateur est marqué `is_community` : s'il est
  public, le site affiche un avertissement et la sauvegarde roulante 48 h est
  activée côté Core. Un cluster communautaire privé n'a aucune sauvegarde.
- Les clusters à code modifié (`has_custom_code`) utilisent un fork isolé et
  sont présentés séparément des clusters classiques.

## Sécurité

- Jetons Discord chiffrés au repos et jamais renvoyés au frontend.
- Jetons d'API opaques, hachés en base côté serveur, à durée limitée.
- Le coffre local utilise AES-256-GCM ; la clé maître est confiée au trousseau
  du système. En l'absence de trousseau, un fichier `0600` sert de repli.
- Les secrets reçus du serveur sont scellés (X25519 + HKDF-SHA256 +
  AES-256-GCM) et ne sont ouverts qu'en mémoire.
- Validation des identifiants et des chemins pour empêcher toute traversée de
  répertoire.

### Limites assumées

- Les quotas CPU/RAM sont **best-effort** : ils protègent contre un bot qui
  s'emballe, pas contre du code malveillant. Ce n'est pas une sandbox.
- L'hôte qui exécute un bot peut lire le jeton Discord dans l'environnement ou
  la mémoire du processus. Le chiffrement et le scellement protègent le
  transport et le stockage, **pas** contre un administrateur local malveillant.
  N'hébergez que des bots dont vous acceptez le code.
- Le runtime Bun et les dépendances npm des bots s'exécutent avec les droits de
  l'utilisateur qui lance Zenode Host.
- Le code partagé signifie qu'une modification du worker classique s'applique à
  tous les bots classiques hébergés par cette machine. Utilisez un cluster à
  code modifié pour isoler un fork.

## Licence

MIT.

## Development Setup

### Quick Start Scripts

Two convenience scripts are provided to launch both the Core API and Desktop application in development mode:

#### **Standard Script (Fast, simple)**
```bash
# Launch both Core and Desktop app (default)
./start-dev.sh

# Launch only Core API
./start-dev.sh --core-only

# Launch only Desktop app
./start-dev.sh --app-only

# Launch with custom ports
./start-dev.sh --core-port 3001 --app-port 1421

# Show help
./start-dev.sh --help
```

#### **Simple Script (Robust, troubleshooting friendly)**
```bash
# Launch both Core and Desktop app (with step-by-step validation)
./start-dev-simple.sh

# Launch only Core API
./start-dev-simple.sh  # then choose option 2

# Launch only Desktop app
./start-dev-simple.sh  # then choose option 3

# Show help
./start-dev-simple.sh --help
```

**Recommended**: Use `start-dev.sh` for normal development. Use `start-dev-simple.sh` if you encounter network connection issues or need step-by-step troubleshooting.

### Manual Development Setup

If you prefer to run the services separately:

```bash
# Start Core API (in ../Core directory)
cd ../Core
npm run dev -- --port 3000

# Start Desktop app (in this directory)
cd Desktop
npm run tauri:dev
```

### Prerequisites

Both the Core API and Desktop app require:

- **Node.js >= 18.0.0**
- **npm >= 9.0.0**
- **Rust + Cargo** (for Tauri desktop app)

### Dependencies

```bash
# Install dependencies for both projects
cd ../Core
npm install

cd Desktop
npm install
```

### Build Commands

```bash
# Build the desktop application (produces executable)
cd Desktop
npm run tauri:build

# Build frontend assets (if needed)
npm run build
```

### Stopping Development Services

When you're done with development, use the provided script to stop both the Core API and Desktop app gracefully:

```bash
# Stop both Core and Desktop app
./stop-dev.sh

# Stop only Core API
./stop-dev.sh --core-only

# Stop only Desktop app
./stop-dev.sh --app-only

# Force stop all processes (emergency)
./stop-dev.sh --force

# Show help
./stop-dev.sh --help
```

**Features**:
- ✅ Graceful shutdown with SIGTERM
- ✅ Force stop option for emergency situations
- ✅ PID file validation and cleanup
- ✅ Port-based process detection
- ✅ Comprehensive error handling
- ✅ Detailed status feedback

**Typical workflow**:
```bash
# Start development
./start-dev.sh

# ... work on your code ...

# Stop services
./stop-dev.sh

# Or force stop if scripts don't respond
./stop-dev.sh --force
```

### Network Troubleshooting

If you encounter network connection issues:

1. **Check if services are running**:
   ```bash
   ./stop-dev.sh --core-only    # Stop Core API
   ./stop-dev.sh --app-only     # Stop Desktop app
   ```

2. **Restart with validation**:
   ```bash
   ./stop-dev.sh               # Clean stop
   ./start-dev-simple.sh       # Start with connectivity testing
   ```

3. **Check network status**:
   ```bash
   curl -s http://localhost:3000/health    # Core API health check
   curl -s http://localhost:1420/          # Desktop app health check
   ```

4. **Manual process management** (if scripts fail):
   ```bash
   # Find and stop processes manually
   lsof -ti :3000 | xargs kill -9     # Core API
   lsof -ti :1420 | xargs kill -9     # Desktop app
   ```
