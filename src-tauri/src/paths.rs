use std::path::PathBuf;

use crate::error::{err, AppResult};

/// Chemins de l'application. Tout ce qui est modifiable par l'utilisateur vit
/// sous `data_dir` ; le runtime téléchargé est isolé dans `runtime_dir` pour
/// pouvoir être remplacé sans toucher aux bots.
#[derive(Clone, Debug)]
pub struct AppPaths {
    pub data_dir: PathBuf,
    pub bots_dir: PathBuf,
    pub runtime_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub state_file: PathBuf,
    pub secrets_file: PathBuf,
}

impl AppPaths {
    pub fn resolve(app: &tauri::AppHandle) -> AppResult<Self> {
        use tauri::Manager;
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|_| err("Dossier de données indisponible"))?;
        let cache_dir = app
            .path()
            .app_cache_dir()
            .unwrap_or_else(|_| data_dir.join("cache"));
        let paths = Self::from_root(data_dir, cache_dir);
        paths.ensure()?;
        Ok(paths)
    }

    pub fn from_root(data_dir: PathBuf, cache_dir: PathBuf) -> Self {
        let bots_dir = data_dir.join("bots");
        let runtime_dir = data_dir.join("runtime");
        let logs_dir = data_dir.join("logs");
        let state_file = data_dir.join("state.json");
        let secrets_file = data_dir.join("secrets.enc");
        Self {
            data_dir,
            bots_dir,
            runtime_dir,
            logs_dir,
            cache_dir,
            state_file,
            secrets_file,
        }
    }

    fn ensure(&self) -> AppResult<()> {
        for dir in [
            &self.data_dir,
            &self.bots_dir,
            &self.runtime_dir,
            &self.logs_dir,
            &self.cache_dir,
            &self.configs_dir(),
            &self.worker_code_dir(),
        ] {
            std::fs::create_dir_all(dir)?;
        }
        Ok(())
    }

    /// Code unique partagé par tous les bots à code officiel.
    pub fn worker_code_dir(&self) -> PathBuf {
        self.data_dir.join("worker")
    }

    /// Code personnalisé d'un cluster (fork), isolé du code officiel.
    pub fn cluster_code_dir(&self, cluster_id: &str) -> AppResult<PathBuf> {
        if !is_valid_id(cluster_id) {
            return Err(err("Identifiant de cluster invalide"));
        }
        Ok(self.data_dir.join("cluster-code").join(cluster_id))
    }

    /// Configuration par bot (le code reste partagé).
    pub fn configs_dir(&self) -> PathBuf {
        self.data_dir.join("configs")
    }

    /// Valide qu'un identifiant de bot ne peut pas s'échapper du dossier bots.
    pub fn bot_dir(&self, id: &str) -> AppResult<PathBuf> {
        if !is_valid_id(id) {
            return Err(err("Identifiant de bot invalide"));
        }
        Ok(self.bots_dir.join(id))
    }
}

/// Même contrat que `isValidBotId` côté Core/Bot-V2 : alphanumérique, `_`, `-`.
pub fn is_valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal() {
        assert!(!is_valid_id("../etc"));
        assert!(!is_valid_id("a/b"));
        assert!(is_valid_id("bot_01-a"));
    }
}
