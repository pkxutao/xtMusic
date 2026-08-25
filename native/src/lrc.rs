use crate::model::{LyricLine, Lyrics};

pub fn parse_lrc(input: &str) -> Lyrics {
    let mut lyrics = Lyrics::default();
    let text = input.trim_start_matches('\u{feff}');

    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(value) = metadata(line, "ti") {
            lyrics.title = Some(value.to_owned());
            continue;
        }
        if let Some(value) = metadata(line, "ar") {
            lyrics.artist = Some(value.to_owned());
            continue;
        }
        if let Some(value) = metadata(line, "offset") {
            lyrics.offset_ms = value.parse().unwrap_or(0);
            continue;
        }

        let mut cursor = line;
        let mut stamps = Vec::new();
        while let Some(rest) = cursor.strip_prefix('[') {
            let Some(end) = rest.find(']') else { break };
            let stamp = &rest[..end];
            if let Some(time) = parse_time(stamp) {
                stamps.push(time);
                cursor = &rest[end + 1..];
            } else {
                break;
            }
        }
        if stamps.is_empty() {
            continue;
        }
        let content = strip_word_timestamps(cursor).trim().to_owned();
        for time in stamps {
            lyrics.lines.push(LyricLine {
                time: (time + lyrics.offset_ms as f64 / 1000.0).max(0.0),
                text: content.clone(),
            });
        }
    }

    lyrics.lines.sort_by(|a, b| a.time.total_cmp(&b.time));
    lyrics.lines.dedup_by(|a, b| {
        (a.time - b.time).abs() < 0.001 && a.text.trim() == b.text.trim()
    });
    lyrics
}

pub fn active_line(lines: &[LyricLine], time: f64) -> Option<usize> {
    if lines.is_empty() || time + 0.04 < lines[0].time {
        return None;
    }
    let index = lines.partition_point(|line| line.time <= time + 0.04);
    Some(index.saturating_sub(1).min(lines.len() - 1))
}

pub fn line_progress(lines: &[LyricLine], index: usize, time: f64, duration: f64) -> f32 {
    let Some(line) = lines.get(index) else { return 0.0 };
    let next = lines
        .get(index + 1)
        .map(|item| item.time)
        .unwrap_or(duration.max(line.time + 3.5));
    let span = (next - line.time).clamp(0.35, 20.0);
    ((time - line.time) / span).clamp(0.0, 1.0) as f32
}

fn metadata<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let prefix = format!("[{key}:");
    line.strip_prefix(&prefix)?.strip_suffix(']')
}

fn parse_time(value: &str) -> Option<f64> {
    let (minutes, seconds) = value.split_once(':')?;
    let minutes = minutes.parse::<f64>().ok()?;
    let seconds = seconds.parse::<f64>().ok()?;
    if !(0.0..60.0).contains(&seconds) || minutes < 0.0 {
        return None;
    }
    Some(minutes * 60.0 + seconds)
}

fn strip_word_timestamps(input: &str) -> String {
    let chars = input.chars().collect::<Vec<_>>();
    let mut output = String::new();
    let mut index = 0;
    while index < chars.len() {
        if chars[index] == '<' {
            if let Some(relative) = chars[index + 1..].iter().position(|item| *item == '>') {
                let end = index + relative + 1;
                let candidate = chars[index + 1..end].iter().collect::<String>();
                if parse_time(&candidate).is_some() {
                    index = end + 1;
                    continue;
                }
            }
        }
        output.push(chars[index]);
        index += 1;
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_offsets_and_multiple_stamps() {
        let parsed = parse_lrc("[offset:250]\n[00:01.00][00:02.500]hello");
        assert_eq!(parsed.lines.len(), 2);
        assert!((parsed.lines[0].time - 1.25).abs() < 0.001);
        assert!((parsed.lines[1].time - 2.75).abs() < 0.001);
    }

    #[test]
    fn finds_active_line() {
        let parsed = parse_lrc("[00:01.00]a\n[00:02.00]b");
        assert_eq!(active_line(&parsed.lines, 0.5), None);
        assert_eq!(active_line(&parsed.lines, 1.4), Some(0));
        assert_eq!(active_line(&parsed.lines, 2.4), Some(1));
    }
}
