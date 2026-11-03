use super::{
    Number, nullable, optional,
    scalars::{day_number, days_in_month},
};
use serde::{Deserialize, Deserializer, Serialize, de::Error};

macro_rules! integer {
    ($name:ident, $min:expr, $max:expr) => {
        #[derive(Debug, Clone, Copy, PartialEq, Serialize)]
        #[serde(transparent)]
        pub struct $name(pub i32);
        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
                let value = Number::deserialize(d)?.0;
                if value.fract() == 0.0 && value >= f64::from($min) && value <= f64::from($max) {
                    Ok(Self(value as i32))
                } else {
                    Err(D::Error::custom(concat!("invalid ", stringify!($name))))
                }
            }
        }
    };
}
integer!(Year, -999_999, 999_999);
integer!(Month, 1, 12);
integer!(Day, 1, 31);
integer!(Century, 1, 9999);
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Era {
    Bce,
    Ce,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "precision", rename_all = "lowercase", deny_unknown_fields)]
enum DateFields {
    Century {
        era: Era,
        century: Century,
        #[serde(default)]
        approximate: bool,
    },
    Year {
        year: Year,
        #[serde(default)]
        approximate: bool,
    },
    Month {
        year: Year,
        month: Month,
        #[serde(default)]
        approximate: bool,
    },
    Day {
        year: Year,
        month: Month,
        day: Day,
        #[serde(default)]
        approximate: bool,
    },
}
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(transparent)]
pub struct HistoricalDate(DateFields);
impl<'de> Deserialize<'de> for HistoricalDate {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let value = DateFields::deserialize(d)?;
        if let DateFields::Day {
            year, month, day, ..
        } = &value
            && day.0 > days_in_month(year.0, month.0)
        {
            return Err(D::Error::custom("nonexistent historical date"));
        }
        Ok(Self(value))
    }
}
impl HistoricalDate {
    pub fn bounds(&self) -> (i64, i64) {
        match &self.0 {
            DateFields::Century { era, century, .. } => {
                let first = match era {
                    Era::Ce => (century.0 - 1) * 100 + 1,
                    Era::Bce => 1 - century.0 * 100,
                };
                (day_number(first, 1, 1), day_number(first + 100, 1, 1) - 1)
            }
            DateFields::Year { year, .. } => {
                (day_number(year.0, 1, 1), day_number(year.0 + 1, 1, 1) - 1)
            }
            DateFields::Month { year, month, .. } => (
                day_number(year.0, month.0, 1),
                day_number(year.0, month.0, days_in_month(year.0, month.0)),
            ),
            DateFields::Day {
                year, month, day, ..
            } => {
                let day = day_number(year.0, month.0, day.0);
                (day, day)
            }
        }
    }
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
enum TimeFields {
    Point {
        date: HistoricalDate,
        #[serde(
            default,
            deserialize_with = "optional",
            skip_serializing_if = "Option::is_none"
        )]
        original: Option<String>,
    },
    Period {
        #[serde(deserialize_with = "nullable")]
        start: Option<HistoricalDate>,
        #[serde(deserialize_with = "nullable")]
        end: Option<HistoricalDate>,
        #[serde(
            default,
            deserialize_with = "optional",
            skip_serializing_if = "Option::is_none"
        )]
        original: Option<String>,
    },
}
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(transparent)]
pub struct HistoricalTime(TimeFields);
impl<'de> Deserialize<'de> for HistoricalTime {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let value = TimeFields::deserialize(d)?;
        if let TimeFields::Period {
            start: Some(start),
            end: Some(end),
            ..
        } = &value
            && start.bounds().0 > end.bounds().1
        {
            return Err(D::Error::custom("historical period starts after its end"));
        }
        Ok(Self(value))
    }
}
