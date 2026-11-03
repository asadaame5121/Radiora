# Expected: reject invalid JSON payload

## Rejection

- Reject before any table/archive/document write because database.json is not valid JSON.
- No destination DB or completed import marker is accepted.

## Archive/source safety

- The malformed source bytes are retained for diagnosis; do not repair them in place.
