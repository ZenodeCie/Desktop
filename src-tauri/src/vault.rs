use std::collections::HashMap;
use std::path::{Path, PathBuf};

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use parking_lot::RwLock;
use rand::RngCore;
use zeroize::Zeroize;

use crate::error::{err, AppError, AppResult};

const KEYRING_SERVICE: &str = "fr.zenode.host";
const KEYRING_USER: &str = "vault-key";
const KEY_FILE: &str = ".vault-key";

/// Coffre local des secrets (jetons Discord, jetons Core, clé privée d'hôte).
///
/// La clé maître est conservée dans le trousseau du système (Keychain,
/// Credential Manager, Secret Service). Si le trousseau n'est pas disponible
/// (Linux sans session graphique, CI), on retombe sur un fichier `0600` : le
/// chiffrement protège alors contre une copie accidentelle du dossier, pas
/// contre un utilisateur du même compte.
pub struct Vault {
    path: PathBuf,
    key: [u8; 32],
    values: RwLock<HashMap<String, String>>,
}

impl Vault {
    pub fn open(path: &Path) -> AppResult<Self> {
        let key = load_or_create_key(path)?;
        let mut vault = Self {
            path: path.to_path_buf(),
            key,
            values: RwLock::new(HashMap::new()),
        };
        vault.reload()?;
        Ok(vault)
    }

    fn reload(&mut self) -> AppResult<()> {
        if !self.path.exists() {
            return Ok(());
        }
        let raw = std::fs::read_to_string(&self.path)?;
        if raw.trim().is_empty() {
            return Ok(());
        }
        let blob = base64::engine::general_purpose::STANDARD
            .decode(raw.trim())
            .map_err(|_| err("Coffre de secrets illisible"))?;
        if blob.len() < 13 {
            return Err(err("Coffre de secrets corrompu"));
        }
        let (nonce, ciphertext) = blob.split_at(12);
        let cipher =
            Aes256Gcm::new_from_slice(&self.key).map_err(|_| err("Clé du coffre invalide"))?;
        let plain = cipher
            .decrypt(Nonce::from_slice(nonce), ciphertext)
            .map_err(|_| err("Impossible de déverrouiller le coffre local"))?;
        let map: HashMap<String, String> =
            serde_json::from_slice(&plain).map_err(|_| err("Coffre de secrets corrompu"))?;
        *self.values.write() = map;
        Ok(())
    }

    fn persist(&self) -> AppResult<()> {
        let plain = serde_json::to_vec(&*self.values.read())?;
        let mut nonce = [0u8; 12];
        rand::rngs::OsRng.fill_bytes(&mut nonce);
        let cipher =
            Aes256Gcm::new_from_slice(&self.key).map_err(|_| err("Clé du coffre invalide"))?;
        let ciphertext = cipher
            .encrypt(Nonce::from_slice(&nonce), plain.as_slice())
            .map_err(|_| err("Chiffrement du coffre impossible"))?;
        let mut blob = Vec::with_capacity(12 + ciphertext.len());
        blob.extend_from_slice(&nonce);
        blob.extend_from_slice(&ciphertext);
        let encoded = base64::engine::general_purpose::STANDARD.encode(blob);
        atomic_write(&self.path, encoded.as_bytes(), true)
    }

    pub fn get(&self, key: &str) -> Option<String> {
        self.values.read().get(key).cloned()
    }

    pub fn set(&self, key: &str, value: impl Into<String>) -> AppResult<()> {
        self.values.write().insert(key.to_string(), value.into());
        self.persist()
    }

    pub fn remove(&self, key: &str) -> AppResult<()> {
        if self.values.write().remove(key).is_some() {
            self.persist()?;
        }
        Ok(())
    }

    pub fn take(&self, key: &str) -> Option<String> {
        let value = self.values.write().remove(key);
        if value.is_some() {
            let _ = self.persist();
        }
        value
    }
}

fn load_or_create_key(vault_path: &Path) -> AppResult<[u8; 32]> {
    if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER) {
        if let Ok(stored) = entry.get_password() {
            if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(stored) {
                if bytes.len() == 32 {
                    let mut key = [0u8; 32];
                    key.copy_from_slice(&bytes);
                    return Ok(key);
                }
            }
        }
        let mut key = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut key);
        let encoded = base64::engine::general_purpose::STANDARD.encode(key);
        if entry.set_password(&encoded).is_ok() {
            return Ok(key);
        }
    }

    let dir = vault_path
        .parent()
        .ok_or_else(|| err("Dossier du coffre introuvable"))?;
    let key_path = dir.join(KEY_FILE);
    if let Ok(raw) = std::fs::read_to_string(&key_path) {
        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(raw.trim()) {
            if bytes.len() == 32 {
                let mut key = [0u8; 32];
                key.copy_from_slice(&bytes);
                return Ok(key);
            }
        }
    }
    let mut key = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut key);
    let encoded = base64::engine::general_purpose::STANDARD.encode(key);
    atomic_write(&key_path, encoded.as_bytes(), true)?;
    Ok(key)
}

/// Écriture atomique : fichier temporaire puis rename. Évite un coffre tronqué
/// si l'application est tuée pendant la sauvegarde.
pub fn atomic_write(path: &Path, contents: &[u8], private: bool) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| err("Dossier de destination invalide"))?;
    std::fs::create_dir_all(parent)?;
    let tmp = parent.join(format!(
        ".{}.tmp",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("zenode")
    ));
    std::fs::write(&tmp, contents)?;
    restrict_permissions(&tmp, private)?;
    std::fs::rename(&tmp, path)?;
    restrict_permissions(path, private)?;
    Ok(())
}

pub fn restrict_permissions(path: &Path, private: bool) -> AppResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = if private { 0o600 } else { 0o644 };
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))?;
    }
    #[cfg(not(unix))]
    {
        let _ = (path, private);
    }
    Ok(())
}

/// Efface une chaîne sensible de la mémoire autant que faire se peut.
pub fn wipe(value: &mut String) {
    value.zeroize();
}

impl std::fmt::Debug for Vault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Vault").field("path", &self.path).finish()
    }
}

#[allow(dead_code)]
pub fn map_err_io(context: &str) -> impl FnOnce(std::io::Error) -> AppError + '_ {
    move |_| AppError::Message(context.to_string())
}
