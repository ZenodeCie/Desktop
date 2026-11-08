use std::io::Write;
use std::path::{Path, PathBuf};

use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

use crate::error::{err, AppResult};
use crate::models::RuntimeStatus;
use crate::paths::AppPaths;
use crate::vault::{atomic_write, restrict_permissions};

/// Runtime épinglé. Toute mise à jour passe par une release Zenode Host :
/// l'application ne télécharge jamais « la dernière version » à l'exécution.
pub const BUN_VERSION: &str = "1.4.4";
const RELEASE_BASE: &str = "https://github.com/oven-sh/bun/releases/download";

struct Asset {
    name: &'static str,
    sha256: &'static str,
}

fn asset_for_platform() -> AppResult<Asset> {
    let asset = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Asset {
            name: "bun-darwin-aarch64.zip",
            sha256: "c240d7f0ccb90c263a849fcdb09b7ee62630d921348ed6aafda86b9d577bc510",
        },
        ("macos", "x86_64") => Asset {
            name: "bun-darwin-x64.zip",
            sha256: "50a3491f73abc2fe81673171a85762d3bc2cc1680ccecadd983de99adf77977e",
        },
        ("linux", "x86_64") => Asset {
            name: "bun-linux-x64.zip",
            sha256: "bf8ccbfb2b0b80159e0f9a6d15c55317add8077534dbc6130a3edb52fccb395c",
        },
        ("linux", "aarch64") => Asset {
            name: "bun-linux-aarch64.zip",
            sha256: "baa6bb36f51d6e58561e02bbea825038a9df454f673d6d776e8bbf86f8c7850e",
        },
        ("windows", "x86_64") => Asset {
            name: "bun-windows-x64.zip",
            sha256: "cd2c0fccc78f3ede1f50ca827a15f063eda13d4d150a3d0674f4f6e323d864a5",
        },
        ("windows", "aarch64") => Asset {
            name: "bun-windows-aarch64.zip",
            sha256: "2d57a0eec0cb44d95c918c3f9734f60455a1306ae5085d76fc68f44e3ee30d09",
        },
        (os, arch) => {
            return Err(err(format!(
                "Plateforme non prise en charge : {os}/{arch}. Signalez-le sur le dépôt Zenode."
            )))
        }
    };
    Ok(asset)
}

#[derive(Serialize, Clone)]
struct Progress {
    phase: String,
    received: u64,
    total: u64,
    percent: f64,
}

pub struct RuntimeManager {
    paths: AppPaths,
    client: reqwest::Client,
}

impl RuntimeManager {
    pub fn new(paths: AppPaths) -> Self {
        Self {
            paths,
            client: reqwest::Client::builder()
                .user_agent(format!("ZenodeHost/{}", env!("CARGO_PKG_VERSION")))
                .build()
                .unwrap_or_default(),
        }
    }

    pub fn binary_path(&self) -> PathBuf {
        let name = if cfg!(windows) { "bun.exe" } else { "bun" };
        self.paths.runtime_dir.join(name)
    }

    pub fn installed_version(&self) -> Option<String> {
        let marker = self.paths.runtime_dir.join("version");
        let version = std::fs::read_to_string(marker).ok()?;
        let version = version.trim().to_string();
        if version.is_empty() || !self.binary_path().exists() {
            return None;
        }
        Some(version)
    }

    pub fn status(&self) -> RuntimeStatus {
        let version = self.installed_version();
        let size_bytes = std::fs::metadata(self.binary_path())
            .map(|m| m.len())
            .unwrap_or(0);
        RuntimeStatus {
            installed: version.is_some(),
            version,
            path: Some(self.binary_path().to_string_lossy().to_string()),
            pinned_version: BUN_VERSION.to_string(),
            platform: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
            size_bytes,
        }
    }

    pub async fn install(&self, app: &AppHandle) -> AppResult<RuntimeStatus> {
        let asset = asset_for_platform()?;
        let url = format!("{RELEASE_BASE}/bun-v{BUN_VERSION}/{}", asset.name);
        let tmp = self.paths.runtime_dir.join("bun-download.zip");

        emit(
            app,
            Progress {
                phase: "download".into(),
                received: 0,
                total: 0,
                percent: 0.0,
            },
        );
        let response = self.client.get(&url).send().await?;
        if !response.status().is_success() {
            return Err(err(format!(
                "Téléchargement du runtime impossible (HTTP {}).",
                response.status().as_u16()
            )));
        }
        let total = response.content_length().unwrap_or(0);
        let mut received: u64 = 0;
        let mut hasher = Sha256::new();
        let mut file = std::fs::File::create(&tmp)?;
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            hasher.update(&chunk);
            file.write_all(&chunk)?;
            received += chunk.len() as u64;
            let percent = if total > 0 {
                (received as f64 / total as f64) * 90.0
            } else {
                45.0
            };
            emit(
                app,
                Progress {
                    phase: "download".into(),
                    received,
                    total,
                    percent,
                },
            );
        }
        file.flush()?;
        drop(file);

        let digest = hex::encode(hasher.finalize());
        if digest != asset.sha256 {
            let _ = std::fs::remove_file(&tmp);
            return Err(err(
                "Le runtime téléchargé ne correspond pas à l'empreinte attendue. Installation annulée.",
            ));
        }

        emit(
            app,
            Progress {
                phase: "extract".into(),
                received,
                total,
                percent: 92.0,
            },
        );
        extract_bun(&tmp, &self.binary_path())?;
        let _ = std::fs::remove_file(&tmp);
        restrict_permissions(&self.binary_path(), false)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(self.binary_path(), std::fs::Permissions::from_mode(0o755))?;
        }
        atomic_write(
            &self.paths.runtime_dir.join("version"),
            BUN_VERSION.as_bytes(),
            false,
        )?;
        emit(
            app,
            Progress {
                phase: "done".into(),
                received,
                total,
                percent: 100.0,
            },
        );
        Ok(self.status())
    }
}

fn emit(app: &AppHandle, payload: Progress) {
    let _ = app.emit("runtime://progress", payload);
}

fn extract_bun(archive: &Path, destination: &Path) -> AppResult<()> {
    let file = std::fs::File::open(archive)?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| err("Archive du runtime invalide"))?;
    let wanted = if cfg!(windows) { "bun.exe" } else { "bun" };
    for index in 0..zip.len() {
        let mut entry = zip
            .by_index(index)
            .map_err(|_| err("Archive du runtime illisible"))?;
        if !entry.is_file() {
            continue;
        }
        let name = entry
            .enclosed_name()
            .and_then(|path| path.file_name().map(|n| n.to_string_lossy().to_string()))
            .unwrap_or_default();
        if name != wanted {
            continue;
        }
        let mut output = std::fs::File::create(destination)?;
        std::io::copy(&mut entry, &mut output)?;
        output.flush()?;
        return Ok(());
    }
    Err(err("Binaire du runtime introuvable dans l'archive"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_supported_platform_has_a_pinned_asset() {
        let asset = asset_for_platform().unwrap();
        assert!(asset.name.starts_with("bun-"));
        assert_eq!(asset.sha256.len(), 64);
    }
}
