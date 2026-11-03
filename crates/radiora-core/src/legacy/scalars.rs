use serde::{Deserialize, Deserializer, Serialize, de::Error};
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct Id(pub String);
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct Instant(pub String);
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct RelationName(pub String);
// v.number accepts Infinity from JSON.parse("1e400"). Preserve that lexeme first.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(transparent)]
pub struct Number(pub f64);
impl<'de> Deserialize<'de> for Number {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let number = serde_json::Number::deserialize(d)?;
        number
            .to_string()
            .parse::<f64>()
            .map(Self)
            .map_err(D::Error::custom)
    }
}
macro_rules! string_scalar {
    ($name:ident, $validate:expr, $message:literal) => {
        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
                let value = String::deserialize(d)?;
                if ($validate)(&value) {
                    Ok(Self(value))
                } else {
                    Err(D::Error::custom($message))
                }
            }
        }
    };
}
string_scalar!(Id, |v: &str| !v.is_empty(), "ID must not be empty");
string_scalar!(
    RelationName,
    |v: &str| {
        let b = v.as_bytes();
        !b.is_empty()
            && b.len() <= 64
            && b[0].is_ascii_uppercase()
            && b.iter()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || *c == b'_')
    },
    "invalid canonical relation type name"
);
string_scalar!(Instant, canonical_instant, "expected canonical ISO instant");
pub(super) fn days_in_month(year: i32, month: i32) -> i32 {
    match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => 0,
    }
}
pub(super) fn day_number(year: i32, month: i32, day: i32) -> i64 {
    let y = i64::from(year);
    let mut result =
        365 * y + (y + 3).div_euclid(4) - (y + 99).div_euclid(100) + (y + 399).div_euclid(400);
    for m in 1..month {
        result += i64::from(days_in_month(year, m));
    }
    result + i64::from(day) - 1
}
fn canonical_instant(value: &str) -> bool {
    if !value.is_ascii() {
        return false;
    }
    let (year, offset) = match value.len() {
        24 => {
            let Some(year) = digits(&value[..4]) else {
                return false;
            };
            (year, 4)
        }
        27 if value.starts_with(['+', '-']) => {
            let Some(magnitude) = digits(&value[1..7]) else {
                return false;
            };
            let year = if value.starts_with('-') {
                -magnitude
            } else {
                magnitude
            };
            if (0..=9999).contains(&year) {
                return false;
            }
            (year, 7)
        }
        _ => return false,
    };
    let rest = &value[offset..];
    if rest.as_bytes().iter().enumerate().any(|(i, b)| match i {
        0 | 3 => *b != b'-',
        6 => *b != b'T',
        9 | 12 => *b != b':',
        15 => *b != b'.',
        19 => *b != b'Z',
        _ => !b.is_ascii_digit(),
    }) {
        return false;
    }
    let fields: Option<Vec<_>> = [(1, 3), (4, 6), (7, 9), (10, 12), (13, 15), (16, 19)]
        .into_iter()
        .map(|(start, end)| digits(&rest[start..end]))
        .collect();
    let Some(parts) = fields else {
        return false;
    };
    let [month, day, hour, minute, second, millis] = parts[..] else {
        return false;
    };
    if !(1..=12).contains(&month)
        || !(1..=days_in_month(year, month)).contains(&day)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return false;
    }
    let days = day_number(year, month, day) - day_number(1970, 1, 1);
    let time = days * 86_400_000 + i64::from(((hour * 60 + minute) * 60 + second) * 1000 + millis);
    (-8_640_000_000_000_000..=8_640_000_000_000_000).contains(&time)
}
fn digits(value: &str) -> Option<i32> {
    if value.bytes().all(|b| b.is_ascii_digit()) {
        value.parse().ok()
    } else {
        None
    }
}
