use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::Engine;
use hkdf::Hkdf;
use rand::rngs::OsRng;
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};

use crate::error::{err, AppResult};

const INFO: &[u8] = b"zenode-bot-secret-v1";

/// Génère la paire X25519 de la machine. La clé privée ne quitte jamais le
/// coffre local ; la clé publique est enregistrée auprès du Core.
pub fn generate_keypair() -> (String, String) {
    let secret = StaticSecret::random_from_rng(OsRng);
    let public = PublicKey::from(&secret);
    (b64(&secret.to_bytes()), b64(public.as_bytes()))
}

/// Ouvre un secret scellé par le Core :
/// `ephemeral_public(32) || nonce(12) || ciphertext`.
///
/// Le Core dérive la même clé avec ECDH + HKDF-SHA256, en liant les deux clés
/// publiques comme sel. Un ciphertext destiné à une autre machine ne peut pas
/// être ouvert, même par le Core après coup.
pub fn open_sealed(private_key_b64: &str, sealed_b64: &str) -> AppResult<String> {
    let secret_bytes = unb64(private_key_b64)?;
    if secret_bytes.len() != 32 {
        return Err(err("Clé privée invalide"));
    }
    let mut secret_arr = [0u8; 32];
    secret_arr.copy_from_slice(&secret_bytes);
    let secret = StaticSecret::from(secret_arr);

    let blob = unb64(sealed_b64)?;
    if blob.len() < 32 + 12 + 16 {
        return Err(err("Secret scellé invalide"));
    }
    let (ephemeral, rest) = blob.split_at(32);
    let (nonce, ciphertext) = rest.split_at(12);
    let mut ephemeral_arr = [0u8; 32];
    ephemeral_arr.copy_from_slice(ephemeral);
    let ephemeral_public = PublicKey::from(ephemeral_arr);
    let public = PublicKey::from(&secret);
    let shared = secret.diffie_hellman(&ephemeral_public);
    if !shared.was_contributory() {
        return Err(err("Échange de clés invalide"));
    }

    let mut salt = Vec::with_capacity(64);
    salt.extend_from_slice(ephemeral);
    salt.extend_from_slice(public.as_bytes());
    let hk = Hkdf::<Sha256>::new(Some(&salt), shared.as_bytes());
    let mut key = [0u8; 32];
    hk.expand(INFO, &mut key)
        .map_err(|_| err("Dérivation de clé impossible"))?;

    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| err("Clé dérivée invalide"))?;
    let plain = cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| err("Impossible de déchiffrer le secret du bot"))?;
    String::from_utf8(plain).map_err(|_| err("Secret du bot invalide"))
}

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn unb64(value: &str) -> AppResult<Vec<u8>> {
    base64::engine::general_purpose::STANDARD
        .decode(value.trim())
        .map_err(|_| err("Encodage base64 invalide"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keypair_is_stable_and_distinct() {
        let (secret, public) = generate_keypair();
        let (secret2, public2) = generate_keypair();
        assert_ne!(secret, secret2);
        assert_ne!(public, public2);
        assert_eq!(unb64(&secret).unwrap().len(), 32);
        assert_eq!(unb64(&public).unwrap().len(), 32);
    }

    #[test]
    fn rejects_garbage_sealed_payload() {
        let (secret, _) = generate_keypair();
        assert!(open_sealed(&secret, "AAAA").is_err());
    }

    /// Vecteur généré par le Core (Node) : garantit que le format scellé
    /// `ephemeral_public || nonce || ciphertext` reste compatible.
    #[test]
    fn opens_node_sealed_vector() {
        let secret = open_sealed(
            "ERERERERERERERERERERERERERERERERERERERERERE=",
            "D6poTtKIZ7l/Smot7l34zpdOdrcBjj8iocTPJnhXDyAAAQIDBAUGBwgJCgsWLGPViLalsrmeLgOtLwwsXfPRB2qSoCezCh+lEJpBcjDG3lNU",
        )
        .unwrap();
        assert_eq!(secret, "test-secret-token-123");
    }
}
