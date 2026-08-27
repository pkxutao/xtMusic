# XT Music Android Premium UI 0.1.0-alpha03

This Android alpha implements the approved image-rich direction with native Android Views and no WebView.

## Screen hierarchy

- Home: feature hero, recommended artists, recently played, popular albums, favorites.
- Library: paged songs, albums, artists, favorites, and history.
- Artist: large artwork header followed by albums first.
- Album: large cover, metadata, play/shuffle actions, readable track list.
- Now Playing: blurred artwork background, large cover, clickable album, progress and controls, line-level lyric highlighting.

## Artwork behavior

Artwork is loaded only from the signed-in user's FNOS server. Requests use the same authenticated session and redirect policy as the API client. Images are downsampled, cached in memory and on disk, and cross-faded into native `ImageView` controls. Missing artwork uses a deterministic gradient placeholder.

## Performance limits

- Home sections request only small first pages.
- Library pages remain bounded: tracks 100, albums/artists 48.
- Artist detail groups albums from the artist endpoint and does not render the global library.
- Image loading is limited to four background workers and a bounded 160 MB disk cache.
- Lists and grids recycle native row/card views.
