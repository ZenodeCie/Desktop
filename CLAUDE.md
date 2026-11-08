# Zenode Host - CLAUDE.md

## Project Summary

This project implements **Zenode Host**, a desktop application for hosting Discord bots locally and connecting them to the Zenode ecosystem. The application allows users to run their own bots, form clusters (private or public), and integrate with the central Zenode infrastructure at zenode.fr.

### Key Features:
- Desktop application (Rust + Tauri v2) for Windows, macOS, and Linux
- Bot hosting and management with isolated processes
- Cluster management (private/public) for bot distribution
- Integration with Zenode Core API
- Code editing and version isolation
- Automatic backups for public clusters
- Visual administration interface

## What I Want to Achieve with This Codebase

### Core Functionality Goals:
1. **MVP Implementation**: Single machine, single bot with start/stop capabilities, live logs, and code editing
2. **Core Integration**: Machine registration, authentication, and bot assignments via Zenode Core API
3. **Cluster Support**: Private clusters (invite-only) and public clusters (catalog and moderation)
4. **Bot Management**: Add, start, stop, restart, and delete bots with resource monitoring
5. **Code Isolation**: Separate code variants for different clusters with isolated forks
6. **Security**: Encrypted storage of Discord tokens and API credentials
7. **Backups**: Automatic daily backups for public clusters

### Architecture Requirements:
- **Single Codebase**: All bots share the same codebase but can have modified variants
- **Single Database**: Shared MongoDB instance isolated by bot ID
- **Lightweight Isolation**: Each bot runs in its own process with OS-level limits
- **Visual Administration**: GUI for cluster management and bot deployment
- **No Core Installation**: Users don't need to install Core locally

## Main Goals by Priority

1. **MVP (Phase 1)**: Machine registration, single bot lifecycle, live logs, and code editing
2. **Core Integration (Phase 2)**: Authentication, machine registration, and bot assignments
3. **Clusters (Phase 3)**: Private and public clusters with bot distribution
4. **Dashboard & Catalogue (Phase 4)**: Advanced UI features and bot marketplace

## Technical Requirements

### Application Layer (Zenode Host):
- **Language**: Rust
- **Framework**: Tauri v2 (webview system, no Electron)
- **UI**: React 18 with Monaco editor embedded
- **Platform Support**: Windows, macOS, Linux
- **Runtime**: Self-contained Bun distribution (Node.js alternative)
- **Process Management**: OS-native process groups and limits
- **Security**: AES-256-GCM encryption for secrets, system keychain integration

### Integration with Core:
- **API Client**: Direct REST API calls to `zenode.fr`
- **Authentication**: JWT-based tokens with limited lifespans
- **Heartbeat System**: Regular status updates with capability reporting
- **Bot Assignments**: Sealed token delivery for secure Discord token handling
- **Cluster Management**: Private/public cluster support with invitation codes

### Database Requirements:
- **Shared MongoDB**: Single database instance
- **Isolation**: Data isolation by bot ID
- **Backups**: Automated 48-hour rolling backups for public clusters
- **Performance**: Optimized for high-frequency bot operations

### Bot Structure (from Bot-V2 repository):
- **Code Structure**: Similar to existing Zenode bots in `github.com/ZenodeCie/Bot-V2`
- **Configuration**: JSON-based bot configuration
- **Runtime**: State management and process control
- **Token Management**: Secure Discord token handling

## Development Guidelines

### Git Workflow:
```bash
# Before any changes, create a dedicated branch
git checkout -b feat/zenode-host-app  # For the desktop app
# git checkout -b feat/zenode-host-core  # For the Core if modified

# Commit frequently with conventional commits
feat: add bot start/stop functionality
fix: correct token handling in vault
refactor: improve process isolation logic

# Push after each commit or small group
git push origin feat/zenode-host-app
```

### Development Environment:
```bash
# Install dependencies
npm install

# Development mode
npm run tauri:dev

# Type checking
npm run typecheck

# Build application
npm run build
npm run tauri:build

# Rust checks (run from src-tauri)
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

### Build Requirements:
- **Rust**: Stable version
- **Node.js**: 20+
- **System Dependencies**: Tauri v2 prerequisites (varies by OS)

## Key Implementation Details

### Process Isolation:
- Each bot runs in its own process group
- Resource limits (CPU/RAM) applied via OS mechanisms
- Dedicated working directory per bot
- Environment variables controlled (Discord token, bot IDs, etc.)

### Security Features:
- **Token Encryption**: Discord tokens encrypted at rest (AES-256-GCM)
- **Secure Transmission**: X25519 key exchange for sealed boxes
- **Limited Exposure**: Secrets never logged or exposed to frontend
- **Key Management**: System keychain for master key storage
- **Input Validation**: Path traversal and ID validation

### Cluster Management:
- **Private Clusters**: Invitation codes for access control
- **Public Clusters**: Open to all hosts with moderation
- **Community Clusters**: Marked with responsibility disclaimer
- **Code Variants**: Separate forks for custom code
- **Bot Distribution**: Load balancing and failover

### Administration Interface:
- **Dashboard**: Cluster, machine, and bot overview
- **Logs**: Real-time bot output with filtering
- **Resource Monitoring**: CPU/RAM usage per bot
- **Code Editor**: Embedded Monaco editor with save/restart
- **Integration Points**: VS Code/Cursor integration
- **Updates**: Automatic application updates

## Development Approach

### Phased Implementation:
1. **Core Infrastructure**: Authentication, registration, and basic bot management
2. **Bot Lifecycle**: Start/stop/restart with monitoring
3. **Cluster Features**: Public and private cluster support
4. **Advanced Features**: Code editing, backups, and dashboard
5. **Polish**: UI improvements and bug fixes

### Quality Assurance:
- **Type Safety**: Full TypeScript type checking
- **Code Quality**: Clippy and rustfmt compliance
- **Testing**: Unit tests for critical logic
- **Validation**: Input validation and sanitization
- **Security Audits**: Regular security reviews

## Limitations and Known Issues

### Security Limitations:
- CPU/RAM limits are best-effort, not sandboxed
- Local administrators can access bot secrets in memory
- Not a sandbox for malicious code

### Technical Limitations:
- Runtime Bun and npm dependencies execute with user privileges
- Shared worker code affects all standard clusters
- Process isolation depends on OS capabilities

## Project Roadmap

### Phase 1 (MVP - Week 1-2):
- Application skeleton and UI structure
- Bot lifecycle (start/stop/restart)
- Live logs and resource monitoring
- Basic code editor functionality

### Phase 2 (Week 3-4):
- Core integration and authentication
- Machine registration system
- Bot assignment and deployment
- Security features (encryption, seals)

### Phase 3 (Week 5-6):
- Cluster management (private/public)
- Bot distribution and load balancing
- Backup system for public clusters
- Code variant support

### Phase 4 (Week 7-8):
- Advanced dashboard and catalogue
- Auto-update functionality
- VS Code/Cursor integration
- Final polish and bug fixes

## Getting Started

1. **Prerequisites**: Rust stable, Node.js 20+, Tauri v2 system dependencies
2. **Clone Repository**: This includes the desktop application code
3. **Development Setup**: Run `npm install` and follow development commands
4. **Testing**: Run `cargo test` for Rust components
5. **Building**: Use `npm run tauri:build` for production builds

## Repository Structure

```
Desktop/
├── src/                    # Frontend React code
├── src-tauri/              # Rust application code
│   ├── lib.rs            # Main application entry point
│   ├── commands.rs       # Tauri commands API
│   ├── bot.rs            # Bot lifecycle management
│   ├── core.rs           # Core integration
│   ├── vault.rs          # Encryption and security
│   ├── ...               # Other modules
├── README.md              # Project documentation
├── package.json          # Frontend dependencies
├── src-tauri/Cargo.toml  # Rust dependencies
└── CLAUDE.md             # This file - implementation guidelines
```

## Notes on Integration with Core

This project integrates with the Zenode Core API at `zenode.fr`. Key integration points:

- **Authentication**: `/api/auth` endpoints for login and token management
- **Machine Registration**: `/api/machines` for creating and updating machines
- **Bot Assignments**: `/api/bots` for receiving and deploying bot instances
- **Cluster APIs**: `/api/clusters` for cluster management and invitations
- **Heartbeat**: `/api/heartbeat` for regular status updates

The application only communicates with HTTPS by default, falling back to HTTP for localhost in development.

## Final Summary

This project creates a comprehensive desktop application for hosting and managing Discord bots within the Zenode ecosystem. The implementation follows strict security practices, provides a rich administration interface, and integrates seamlessly with the central Core infrastructure. The phased approach ensures a robust, secure, and user-friendly solution that meets all the specified requirements.