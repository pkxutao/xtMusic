use sha2::{Digest as ShaDigest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};

const AUTHX_PREFIX: &str = "NDzZTVxnRKP8Z0jXg1VAMonaG8akvh";
const API_KEY: &str = "zIGtkc3dqZnJpd29qZXJqa2w7c";

pub fn compute_authx(method: &str, path: &str, body: &serde_json::Value) -> String {
    compute_authx_with_timestamp(method, path, body, now_millis())
}

pub fn compute_fn_sign(fn_id: &str, timestamp: i64) -> String {
    sha256_hex(&format!("trim_connect`{fn_id}`{timestamp}`anna"))
}

pub(crate) fn compute_authx_with_timestamp(
    method: &str,
    path: &str,
    body: &serde_json::Value,
    timestamp: i64,
) -> String {
    let nonce = format!("{:06}", 100_000 + timestamp.rem_euclid(900_000));
    compute_authx_at(method, path, body, &nonce, &timestamp.to_string())
}

pub(crate) fn compute_authx_at(
    method: &str,
    path: &str,
    body: &serde_json::Value,
    nonce: &str,
    timestamp: &str,
) -> String {
    let serialized = if method.eq_ignore_ascii_case("GET") {
        serialize_query(body)
    } else {
        serde_json::to_string(body).unwrap_or_else(|_| "{}".to_owned())
    };
    let body_md5 = format!("{:x}", md5::compute(serialized.as_bytes()));
    let raw = [AUTHX_PREFIX, path, nonce, timestamp, &body_md5, API_KEY].join("_");
    let sign = format!("{:x}", md5::compute(raw.as_bytes()));
    format!("nonce={nonce}&timestamp={timestamp}&sign={sign}")
}

pub(crate) fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub(crate) fn sha256_hex(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn serialize_query(value: &serde_json::Value) -> String {
    let Some(object) = value.as_object() else {
        return String::new();
    };
    let mut pairs: Vec<_> = object.iter().collect();
    pairs.sort_by(|a, b| a.0.cmp(b.0));
    pairs
        .into_iter()
        .map(|(key, value)| {
            let value = value
                .as_str()
                .map(ToOwned::to_owned)
                .unwrap_or_else(|| value.to_string());
            format!("{}={}", key, urlencoding::encode(&value))
        })
        .collect::<Vec<_>>()
        .join("&")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn authx_matches_documented_vector() {
        let body = json!({"fnId": "demo123"});
        let got = compute_authx_at(
            "post",
            "/api/v1/fn/con",
            &body,
            "123456",
            "1700000000000",
        );
        assert_eq!(
            got,
            "nonce=123456&timestamp=1700000000000&sign=530706fa1256fc579a88c49f11b0f3fc"
        );
    }

    #[test]
    fn password_digest_is_stable() {
        assert_eq!(
            sha256_hex("password"),
            "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"
        );
    }
}
