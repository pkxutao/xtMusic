#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LyricLine {
    pub time_ms: u64,
    pub text: String,
}

pub fn parse_lrc(input: &str) -> Vec<LyricLine> {
    let mut offset_ms = 0i64;
    for line in input.trim_start_matches('\u{feff}').lines() {
        let trimmed = line.trim();
        if let Some(value) = trimmed
            .strip_prefix("[offset:")
            .and_then(|value| value.strip_suffix(']'))
            .and_then(|value| value.trim().parse::<i64>().ok())
        {
            offset_ms = value;
        }
    }

    let mut result = Vec::new();
    for raw_line in input.trim_start_matches('\u{feff}').lines() {
        let line = raw_line.trim();
        let mut rest = line;
        let mut times = Vec::new();
        while let Some(after_open) = rest.strip_prefix('[') {
            let Some(close) = after_open.find(']') else {
                break;
            };
            let tag = &after_open[..close];
            if let Some(time_ms) = parse_timestamp(tag) {
                times.push(time_ms);
                rest = &after_open[close + 1..];
            } else {
                break;
            }
        }
        if times.is_empty() {
            continue;
        }
        let text = strip_word_timestamps(rest).trim().to_owned();
        for time_ms in times {
            let adjusted = (time_ms as i64 + offset_ms).max(0) as u64;
            result.push(LyricLine {
                time_ms: adjusted,
                text: text.clone(),
            });
        }
    }

    result.sort_by_key(|line| line.time_ms);
    result.dedup_by(|a, b| a.time_ms == b.time_ms && a.text == b.text);
    result
}

pub fn active_lyric_index(lines: &[LyricLine], position_ms: u64) -> Option<usize> {
    if lines.is_empty() || position_ms < lines[0].time_ms {
        return None;
    }
    match lines.binary_search_by_key(&position_ms, |line| line.time_ms) {
        Ok(index) => Some(index),
        Err(index) => index.checked_sub(1),
    }
}

fn parse_timestamp(value: &str) -> Option<u64> {
    let (minutes, rest) = value.split_once(':')?;
    let minutes = minutes.trim().parse::<u64>().ok()?;
    let (seconds, fraction) = match rest.split_once('.') {
        Some(parts) => parts,
        None => (rest, "0"),
    };
    let seconds = seconds.trim().parse::<u64>().ok()?;
    if seconds >= 60 {
        return None;
    }
    let millis = match fraction.trim().len() {
        0 => 0,
        1 => fraction.trim().parse::<u64>().ok()? * 100,
        2 => fraction.trim().parse::<u64>().ok()? * 10,
        _ => fraction.trim()[..3].parse::<u64>().ok()?,
    };
    Some((minutes * 60 + seconds) * 1_000 + millis)
}

fn strip_word_timestamps(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'<' {
            if let Some(relative) = value[index + 1..].find('>') {
                let end = index + 1 + relative;
                if parse_timestamp(&value[index + 1..end]).is_some() {
                    index = end + 1;
                    continue;
                }
            }
        }
        let ch = value[index..].chars().next().unwrap_or_default();
        output.push(ch);
        index += ch.len_utf8();
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_offset_multiple_tags_and_word_timestamps() {
        let lines = parse_lrc(
            "\u{feff}[offset:120]\n[00:01.20][00:02.300]<00:01.20>你<00:01.60>好\n",
        );
        assert_eq!(
            lines,
            vec![
                LyricLine {
                    time_ms: 1_320,
                    text: "你好".to_owned(),
                },
                LyricLine {
                    time_ms: 2_420,
                    text: "你好".to_owned(),
                },
            ]
        );
    }

    #[test]
    fn finds_active_line() {
        let lines = vec![
            LyricLine {
                time_ms: 1_000,
                text: "a".to_owned(),
            },
            LyricLine {
                time_ms: 2_000,
                text: "b".to_owned(),
            },
        ];
        assert_eq!(active_lyric_index(&lines, 999), None);
        assert_eq!(active_lyric_index(&lines, 1_999), Some(0));
        assert_eq!(active_lyric_index(&lines, 2_000), Some(1));
    }
}
