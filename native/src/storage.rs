use crate::api::{AppError, AppResult};
use crate::model::{SavedProfile, SecretRecord, Settings};
use directories::ProjectDirs;
use keyring::Entry;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const KEYRING_SERVICE: &str = "com.pkxutao.xtmusic.native";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AccountsFile {
    version: u32,
    active_id: Option<String>,
    accounts: Vec<SavedProfile>,
}

pub struct Storage {
    root: PathBuf,
    accounts: RwLock<AccountsFile>,
    settings: RwLock<Settings>,
    ephemeral: RwLock<HashMap<String, SecretRecord>>,
}

impl Storage {
    pub fn new() -> AppResult<Self> {
        let dirs = ProjectDirs::from("com", "pkxutao", "XT Music Native")
            .ok_or_else(|| AppError::new("STORAGE_UNAVAILABLE", "无法定位用户配置目录"))?;
        let root = dirs.config_dir().to_path_buf();
        fs::create_dir_all(&root)
            .map_err(|error| AppError::new("STORAGE_FAILED", error.to_string()))?;
        fs::create_dir_all(dirs.cache_dir())
            .map_err(|error| AppError::new("CACHE_FAILED", error.to_string()))?;
        let accounts = read_json::<AccountsFile>(&root.join("accounts.json")).unwrap_or_default();
        let settings = read_json::<Settings>(&root.join("settings.json")).unwrap_or_default();
        Ok(Self {
            root,
            accounts: RwLock::new(accounts),
            settings: RwLock::new(settings),
            ephemeral: RwLock::new(HashMap::new()),
        })
    }

    pub fn cache_dir(&self) -> PathBuf {
        ProjectDirs::from("com", "pkxutao", "XT Music Native")
            .map(|dirs| dirs.cache_dir().to_path_buf())
            .unwrap_or_else(|| self.root.join("cache"))
    }

    pub fn profiles(&self) -> Vec<SavedProfile> {
        let ephemeral = self.ephemeral.read();
        let mut profiles = self.accounts.read().accounts.clone();
        for profile in &mut profiles {
            profile.has_session = ephemeral.contains_key(&profile.id)
                || keyring_secret(&profile.id)
                    .map(|secret| !secret.token.is_empty())
                    .unwrap_or(false);
        }
        profiles.sort_by(|a, b| b.last_used_at.cmp(&a.last_used_at));
        profiles
    }

    pub fn active_id(&self) -> Option<String> {
        self.accounts.read().active_id.clone()
    }

    pub fn active_profile(&self) -> Option<SavedProfile> {
        let id = self.active_id()?;
        self.profile(&id)
    }

    pub fn profile(&self, id: &str) -> Option<SavedProfile> {
        let mut profile = self
            .accounts
            .read()
            .accounts
            .iter()
            .find(|item| item.id == id)
            .cloned()?;
        profile.has_session = self.ephemeral.read().contains_key(id)
            || keyring_secret(id)
                .map(|secret| !secret.token.is_empty())
                .unwrap_or(false);
        Some(profile)
    }

    pub fn secret(&self, id: &str) -> Option<SecretRecord> {
        self.ephemeral
            .read()
            .get(id)
            .cloned()
            .or_else(|| keyring_secret(id))
    }

    pub fn save_profile(
        &self,
        mut profile: SavedProfile,
        secret: SecretRecord,
        remember: bool,
    ) -> AppResult<(SavedProfile, bool)> {
        let now = chrono::Utc::now().timestamp_millis();
        if profile.id.is_empty() {
            profile.id = Uuid::new_v4().to_string();
        }
        if profile.name.trim().is_empty() {
            profile.name = profile.username.clone();
        }
        profile.last_used_at = now;
        profile.has_session = true;

        let mut keyring_secure = false;
        if remember {
            if let Ok(entry) = Entry::new(KEYRING_SERVICE, &format!("account:{}", profile.id)) {
                if let Ok(encoded) = serde_json::to_string(&secret) {
                    if entry.set_password(&encoded).is_ok() {
                        keyring_secure = true;
                        self.ephemeral.write().remove(&profile.id);
                    }
                }
            }
        }
        if !keyring_secure {
            self.ephemeral
                .write()
                .insert(profile.id.clone(), secret);
        }

        {
            let mut accounts = self.accounts.write();
            accounts.version = 2;
            accounts.accounts.retain(|item| item.id != profile.id);
            let mut persisted = profile.clone();
            persisted.has_session = false;
            accounts.accounts.push(persisted);
            accounts.active_id = Some(profile.id.clone());
            self.write_accounts(&accounts)?;
        }
        Ok((profile, keyring_secure))
    }

    pub fn touch(&self, id: &str) -> AppResult<()> {
        let mut accounts = self.accounts.write();
        let now = chrono::Utc::now().timestamp_millis();
        if let Some(profile) = accounts.accounts.iter_mut().find(|item| item.id == id) {
            profile.last_used_at = now;
            accounts.active_id = Some(id.to_owned());
            self.write_accounts(&accounts)?;
        }
        Ok(())
    }

    pub fn clear_session(&self, id: &str) {
        self.ephemeral.write().remove(id);
        if let Ok(entry) = Entry::new(KEYRING_SERVICE, &format!("account:{id}")) {
            let _ = entry.set_password("");
        }
    }

    pub fn remove_profile(&self, id: &str) -> AppResult<()> {
        self.clear_session(id);
        let mut accounts = self.accounts.write();
        accounts.accounts.retain(|item| item.id != id);
        if accounts.active_id.as_deref() == Some(id) {
            accounts.active_id = None;
        }
        self.write_accounts(&accounts)
    }

    pub fn clear_active(&self) -> AppResult<()> {
        let mut accounts = self.accounts.write();
        accounts.active_id = None;
        self.write_accounts(&accounts)
    }

    pub fn settings(&self) -> Settings {
        self.settings.read().clone()
    }

    pub fn save_settings(&self, settings: Settings) -> AppResult<()> {
        write_json_atomic(&self.root.join("settings.json"), &settings)?;
        *self.settings.write() = settings;
        Ok(())
    }

    fn write_accounts(&self, accounts: &AccountsFile) -> AppResult<()> {
        write_json_atomic(&self.root.join("accounts.json"), accounts)
    }
}

fn keyring_secret(id: &str) -> Option<SecretRecord> {
    let entry = Entry::new(KEYRING_SERVICE, &format!("account:{id}")).ok()?;
    let encoded = entry.get_password().ok()?;
    if encoded.is_empty() {
        return None;
    }
    serde_json::from_str(&encoded).ok()
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let bytes = fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| AppError::new("STORAGE_FAILED", error.to_string()))?;
    let temporary = path.with_extension("tmp");
    fs::write(&temporary, bytes)
        .map_err(|error| AppError::new("STORAGE_FAILED", error.to_string()))?;
    fs::rename(&temporary, path)
        .map_err(|error| AppError::new("STORAGE_FAILED", error.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_is_not_part_of_persisted_profile() {
        let profile = SavedProfile {
            username: "demo".into(),
            ..Default::default()
        };
        let json = serde_json::to_string(&profile).unwrap();
        assert!(!json.to_ascii_lowercase().contains("password"));
        assert!(!json.to_ascii_lowercase().contains("token"));
    }
}
