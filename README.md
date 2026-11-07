# Zenode Host

Application desktop (Windows, macOS, Linux) pour héberger des bots Discord
TypeScript sur sa propre machine, seul ou au sein d'un cluster Zenode.

Construite avec **Tauri v2**, **Rust** et **React 18**. L'interface reprend la
charte de [zenode.fr](https://zenode.fr).

## Fonctionnalités

- **Installation minimale** : un runtime Bun épinglé est téléchargé à la
  demande, vérifié par SHA-256 puis extrait dans le dossier de données de
  l'application. Aucun Node.js ni Bun global n'est requis.
- **Un processus par bot** : démarrage, arrêt, redémarrage (politique et
  nombre maximal de tentatives), arrêt automatique des arbres de processus.
- **Logs en direct**, métriques CPU/RAM, détection de la connexion Discord.
- **Éditeur Monaco intégré** (embarqué localement, aucun CDN), avec boutons
  « Ouvrir dans VS Code / Cursor ».
- **Coffre chiffré** : jetons Discord, jetons Core et clé privée d'hôte sont
  chiffrés en AES-256-GCM ; la clé maître vit dans le trousseau du système.
- **Clusters** : liaison de l'application au compte Zenode, heartbeats,
  affectations de bots, clusters privés (invitation) et publics (catalogue et
  modération), reprise après panne.
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

1. Le code du bot vit dans `<données app>/bots/<id>/` (fichiers TypeScript,
   `zenode.bot.json`, `package.json`).
2. Le jeton Discord n'est **jamais** écrit dans ces fichiers : il est lu dans le
   coffre et injecté au processus via `DISCORD_TOKEN` / `BOT_TOKEN`.
3. Le processus est lancé avec Bun, dans un groupe de processus dédié, avec des
   limites best-effort (mémoire, fichiers ouverts, CPU).
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

## Licence

MIT.
