//! Native XT Music protocol core.
//!
//! This crate contains no browser runtime, HTML, CSS, JavaScript, or WebView.
//! It implements FN Connect discovery, FlyMusic authentication, music-library
//! paging, media URLs, strict redirect handling, and LRC parsing.

mod authx;
mod client;
mod discovery;
mod error;
mod lrc;
mod models;

pub use authx::{compute_authx, compute_fn_sign};
pub use client::FnMusicClient;
pub use discovery::{DiscoveryOptions, FnDiscovery, normalize_service_url};
pub use error::CoreError;
pub use lrc::{LyricLine, active_lyric_index, parse_lrc};
pub use models::{
    AlbumRef, ApiEnvelope, ArtistRef, AudioSpec, ConnectionCandidate,
    ConnectionResult, LoginResult, MediaHeaders, Page, Session, Track,
};
