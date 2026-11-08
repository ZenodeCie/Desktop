use serde::Serialize;

/// Erreur sérialisable renvoyée aux commandes Tauri.
///
/// On ne renvoie jamais de détail interne sensible (token, clé, chemin secret) :
/// les messages sont rédigés pour l'utilisateur, le détail technique reste dans
/// les logs locaux.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Message(String),
    #[error("bibliothèque système : {0}")]
    Io(#[from] std::io::Error),
    #[error("stockage local : {0}")]
    Json(#[from] serde_json::Error),
    #[error("réseau : {0}")]
    Http(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(value: reqwest::Error) -> Self {
        let kind = if value.is_timeout() {
            "délai dépassé"
        } else if value.is_connect() {
            "connexion impossible"
        } else {
            "échec de la requête"
        };
        AppError::Http(format!("{kind} vers le Core"))
    }
}

pub type AppResult<T> = Result<T, AppError>;

pub fn err(message: impl Into<String>) -> AppError {
    AppError::Message(message.into())
}
