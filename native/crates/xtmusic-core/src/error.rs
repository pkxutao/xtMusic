use thiserror::Error;

#[derive(Debug, Clone, Error)]
pub enum CoreError {
    #[error("服务器地址或 FN ID 不能为空")]
    ServerRequired,
    #[error("服务器地址格式不正确：{0}")]
    InvalidUrl(String),
    #[error("不允许使用未加密 HTTP；请仅在可信局域网明确启用")]
    HttpNotAllowed,
    #[error("FN Connect 查询失败：{0}")]
    FnLookup(String),
    #[error("没有找到可连接的飞牛音乐服务：{0}")]
    NoReachableServer(String),
    #[error("此服务器启用了访问安全码，请填写后重试")]
    AccessCodeRequired,
    #[error("访问安全码不正确")]
    InvalidAccessCode,
    #[error("飞牛音乐账号或密码错误")]
    InvalidCredentials,
    #[error("登录状态已失效")]
    SessionExpired,
    #[error("服务器返回错误：{0}")]
    Server(String),
    #[error("服务器返回了无法解析的数据：{0}")]
    InvalidResponse(String),
    #[error("已阻止不安全的重定向：{0}")]
    UnsafeRedirect(String),
    #[error("网络请求失败：{0}")]
    Network(String),
}

impl From<reqwest::Error> for CoreError {
    fn from(value: reqwest::Error) -> Self {
        Self::Network(value.to_string())
    }
}

impl From<url::ParseError> for CoreError {
    fn from(value: url::ParseError) -> Self {
        Self::InvalidUrl(value.to_string())
    }
}
