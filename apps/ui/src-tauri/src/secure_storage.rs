use keyring::{Entry, Error as KeyringError};
use sha2::{Digest, Sha256};

const SERVICE_NAMESPACE: &str = "dev.happier.desktop.device-local-storage.v1";
const KEY_DOMAIN: &[u8] = b"happier.desktop.device-local-storage.v1\0";

fn opaque_scoped_key(key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(KEY_DOMAIN);
    hasher.update(key.as_bytes());
    format!("{:x}", hasher.finalize())
}

trait SecureStorageBackend {
    fn read(&self, key: &str) -> Result<Option<String>, String>;
    fn write(&self, key: &str, value: &str) -> Result<(), String>;
    fn remove(&self, key: &str) -> Result<(), String>;
}

struct OsKeyringBackend;

impl OsKeyringBackend {
    fn entry(key: &str) -> Result<Entry, String> {
        Entry::new(SERVICE_NAMESPACE, &opaque_scoped_key(key))
            .map_err(|error| format!("secure storage entry unavailable: {error}"))
    }
}

impl SecureStorageBackend for OsKeyringBackend {
    fn read(&self, key: &str) -> Result<Option<String>, String> {
        match Self::entry(key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(error) => Err(format!("secure storage read failed: {error}")),
        }
    }

    fn write(&self, key: &str, value: &str) -> Result<(), String> {
        Self::entry(key)?
            .set_password(value)
            .map_err(|error| format!("secure storage write failed: {error}"))
    }

    fn remove(&self, key: &str) -> Result<(), String> {
        match Self::entry(key)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(format!("secure storage remove failed: {error}")),
        }
    }
}

async fn run_blocking<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("secure storage operation could not complete: {error}"))?
}

#[tauri::command]
pub async fn desktop_secure_storage_read(key: String) -> Result<Option<String>, String> {
    run_blocking(move || OsKeyringBackend.read(&key)).await
}

#[tauri::command]
pub async fn desktop_secure_storage_write(key: String, value: String) -> Result<(), String> {
    run_blocking(move || OsKeyringBackend.write(&key, &value)).await
}

#[tauri::command]
pub async fn desktop_secure_storage_remove(key: String) -> Result<(), String> {
    run_blocking(move || OsKeyringBackend.remove(&key)).await
}

#[cfg(test)]
mod tests {
    use super::{opaque_scoped_key, SecureStorageBackend};

    #[derive(Default)]
    struct MemoryBackend {
        value: std::sync::Mutex<Option<String>>,
    }

    impl SecureStorageBackend for MemoryBackend {
        fn read(&self, _key: &str) -> Result<Option<String>, String> {
            Ok(self.value.lock().expect("memory backend lock").clone())
        }

        fn write(&self, _key: &str, value: &str) -> Result<(), String> {
            *self.value.lock().expect("memory backend lock") = Some(value.to_owned());
            Ok(())
        }

        fn remove(&self, _key: &str) -> Result<(), String> {
            *self.value.lock().expect("memory backend lock") = None;
            Ok(())
        }
    }

    #[test]
    fn scoped_keys_are_stable_opaque_and_domain_separated() {
        let key = opaque_scoped_key("home:https://example.test:token");
        assert_eq!(key.len(), 64);
        assert!(key.chars().all(|value| value.is_ascii_hexdigit()));
        assert!(!key.contains("example"));
        assert_eq!(key, opaque_scoped_key("home:https://example.test:token"));
        assert_ne!(key, opaque_scoped_key("home:https://other.test:token"));
    }

    #[test]
    fn backend_roundtrip_and_idempotent_remove_preserve_command_contract() {
        let backend = MemoryBackend::default();
        assert_eq!(backend.read("key").expect("initial read"), None);
        backend.write("key", "secret").expect("write");
        assert_eq!(
            backend.read("key").expect("readback"),
            Some("secret".to_owned())
        );
        backend.remove("key").expect("remove");
        backend.remove("key").expect("idempotent remove");
        assert_eq!(backend.read("key").expect("removed read"), None);
    }
}
