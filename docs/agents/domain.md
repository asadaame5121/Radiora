# Domain Docs

Before exploring, read the relevant domain documentation:

- `CONTEXT.md` at the repository root
- `docs/adr/` entries affecting the area being changed

If these files do not exist, proceed silently. The domain-modeling workflow creates them only when terms or decisions are resolved.

## File structure

This repository uses a single-context layout:

/
├── CONTEXT.md
├── docs/adr/
└── src/

Use terminology defined in `CONTEXT.md`. Explicitly flag output that conflicts with an existing ADR.
