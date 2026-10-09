"""Summarize OperationLog durations with mean, nearest-rank percentiles, and sessions."""

import argparse
import csv
import json
import math
from collections import defaultdict
from pathlib import Path


def analyze(source: Path, output: Path) -> None:
    groups = defaultdict(list)
    sessions = defaultdict(list)
    with source.open(encoding="utf-8") as stream:
        for line in stream:
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue  # An interrupted final write may leave a partial line.
            key = (row["timestamp"][:10], row["event"], row["outcome"])
            groups[key].append(row["durationMs"])
            sessions[row["sessionId"]].append((row["timestamp"], row["event"]))

    with output.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow((
            "day",
            "event",
            "outcome",
            "count",
            "average_duration_ms",
            "p50_duration_ms",
            "p95_duration_ms",
            "p99_duration_ms",
            "max_duration_ms",
        ))
        for key, durations in sorted(groups.items()):
            ordered = sorted(durations)
            count = len(ordered)
            writer.writerow((
                *key,
                count,
                round(sum(ordered) / count, 2),
                percentile(ordered, 0.5),
                percentile(ordered, 0.95),
                percentile(ordered, 0.99),
                round(ordered[-1], 2),
            ))

    flow_path = output.with_name(f"{output.stem}-sessions.csv")
    with flow_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(("session_id", "timestamp", "event"))
        for session_id, events in sorted(sessions.items()):
            for timestamp, event in sorted(events):
                writer.writerow((session_id, timestamp, event))


def percentile(sorted_values: list[float], quantile: float) -> float:
    rank = max(0, math.ceil(quantile * len(sorted_values)) - 1)
    return round(sorted_values[rank], 2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("jsonl", type=Path)
    parser.add_argument("csv", type=Path)
    args = parser.parse_args()
    analyze(args.jsonl, args.csv)
