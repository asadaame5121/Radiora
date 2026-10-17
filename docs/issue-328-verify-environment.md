# Issue 328 verify environment

This records a narrow `deno task lint` adjustment for managed Windows checkouts. That change and its
validation are only one part of Issue 328; final accumulated completion evidence is recorded in
`issue-328-ui-contract-migration-plan.md` §15.

## Change

The lint task now passes the six source roots already listed in `biome.json`: `src`, `scripts`,
`tests`, `vitest`, `stories`, and `.storybook`. Biome's include and exclude configuration, lint
rules, and severities are unchanged. There is no Biome configuration, rule, severity, or dependency
change in this stage.

The exact root-level ignore pattern responsible for Biome ignoring the managed checkout's absolute
path has not been isolated. The observed behavior does not establish that `.delta` alone is the
cause; this change avoids relying on a process-only workaround or weakening the scan.

## Evidence

Environment: Node `v25.2.1`; Deno `2.9.7` (stable, x86_64-pc-windows-msvc); Biome `2.5.2`.

Before the change, exact `deno task lint` ran `npm exec -- biome lint`, checked 0 files, and failed
with “No files were processed in the specified paths.” The ignored path was the managed checkout's
`.delta/worktrees/.../Radiora` absolute path. A direct Biome invocation with all six configured
roots was previously observed to process 583 files and exit 0, with baseline warnings. The
root-pattern cause was not conclusively identified.

After the change, exact `deno task lint` passed: Biome checked 583 files, with 225 warnings and 22
informational diagnostics and no fixes. The warning output exceeded Biome's display limit; no
warning was promoted to an error.

Parent review confirmed `tests/ui/command-palette.spec.ts` was an Issue 328 Stage 3 deliverable and
authorized formatter-only edits. Applied only the whitespace/reflow changes requested by
`deno fmt --check`; no test semantics changed. Exact
`deno fmt --check tests/ui/command-palette.spec.ts deno.json` and `git diff --check` pass.

After formatting, exact `deno task verify` passed in full: lint; quality (300 production files);
magic-number ratchet (299 current, 428 baseline); duplicate-code ratchet (23 current, 27 baseline);
formatter check; Deno check; 1,033 Deno tests; 56 Vitest files / 564 tests; and production build.
Biome reported the same 583-file scope and non-fatal baseline diagnostics. The build reported its
existing >500 kB chunk warning.

An optional Playwright run of `tests/ui/command-palette.spec.ts` with `RADIORA_UI_PORT=4174` could
not start because that port was already occupied by a Vite process in another worktree. The
unrelated service on 4173 was left untouched; the Playwright test was not rerun.

Environment for the final verification: Node `v25.2.1`; Deno `2.9.7` (stable,
x86_64-pc-windows-msvc); Biome `2.5.2`. The lint scope matches the six source roots in `biome.json`,
not every file in the repository.

At the time this environment note was written, exact `deno task verify` succeeded while Deno
generated an environment-dependent `deno.lock` resolution update. That generated lock diff was
excluded from that stage's deliverables. No `package.json` or `package-lock.json` update was made.
Stage 6 later reran the integrated final gate on the accumulated worker checkout and restored its
generated lock diff; see the plan's §15 for the exact results and starting/final hash.
