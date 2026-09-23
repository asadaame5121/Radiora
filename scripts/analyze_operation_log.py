"""Summarize an exported Radiora OperationLog with Python's standard library."""

import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path


def analyze(source: Path, output: Path) -> None:
    groups = defaultdict(lambda: [0, 0.0])
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
            groups[key][0] += 1
            groups[key][1] += row["durationMs"]
            sessions[row["sessionId"]].append((row["timestamp"], row["event"]))

    with output.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(("day", "event", "outcome", "count", "average_duration_ms"))
        for key, (count, duration) in sorted(groups.items()):
            writer.writerow((*key, count, round(duration / count, 2)))

    flow_path = output.with_name(f"{output.stem}-sessions.csv")
    with flow_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(("session_id", "timestamp", "event"))
        for session_id, events in sorted(sessions.items()):
            for timestamp, event in sorted(events):
                writer.writerow((session_id, timestamp, event))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("jsonl", type=Path)
    parser.add_argument("csv", type=Path)
    args = parser.parse_args()
    analyze(args.jsonl, args.csv)
