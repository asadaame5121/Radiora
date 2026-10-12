---
name: land
description: >-
  Land requested Radiora changes through a verified GitHub pull request into
  main. Invoke only when the user explicitly requests landing or merging,
  not for review, preparation, passing checks, or skill installation.
disable-model-invocation: true
metadata:
  delta-action: land
---

# Land Radiora changes

An invocation supplies landing intent. Proceed through preparation, publication, verification,
merge, and destination verification without asking for the same permission again. Stop for genuine
blockers or ambiguous scope.

Applies only to `asadaame5121/Radiora`. The default destination is `main` on GitHub and the default
strategy is squash. Recheck repository settings at each execution rather than treating these
defaults as enforced policy.

## 1. Establish scope and destination

- Read applicable `AGENT.md` / `AGENTS.md`, contribution policies, submission templates, and
  relevant issue requirements. Honor any applicable signing, contributor agreement,
  human-authorship, review, documentation, and changelog requirements. Preserve conditional
  exceptions. Obtain human-authored text if required; approval of generated text is not authorship.
- Inspect `git remote -v`, branch, status, staged and unstaged diffs, untracked files, and commits
  relative to the destination. Identify the requested file changes and commits from the user's task.
  A staged file is not automatically in scope. Ask only when intent cannot establish scope.
- Verify that `origin` points to `asadaame5121/Radiora`; use `origin` for publication, never the
  `local` backlink. If the configured repository differs, stop and resolve the destination.
- Check GitHub authentication, Git identity and signing settings, tool versions, existing PRs,
  repository merge settings, branch protection, and active rulesets. Query protections and rulesets
  separately: a protection endpoint returning 404 does not prove the branch has no rules.
- Use `gh repo view --repo asadaame5121/Radiora --json nameWithOwner,defaultBranchRef` and
  `gh api repos/asadaame5121/Radiora`, plus applicable protection and ruleset endpoints. Verify
  current review, status-check, queue, and permission rules. An inaccessible rule or check is a
  blocker, not permission to bypass it.
- Fetch the intended destination before computing the final diff. Preserve all unrelated staged,
  unstaged, and untracked work. Avoid whole-tree staging, destructive resets, forced updates, and
  automatic stashing of other work.

Completion: the exact change scope, destination, publication remote, and applicable requirements are
known.

## 2. Prepare the change without mixing other work

Reuse an existing topic branch and PR only if their entire destination-relative diff is in scope.
Otherwise prepare a dedicated branch from the fetched destination in an isolated checkout inside the
project workspace, transferring only the requested changes or commits. Inspect the transferred diff
before committing. Preserve the original checkout, index, and unrelated work.

Where requested commits depend on excluded changes, stop and explain that dependency rather than
silently including them. Do not edit another checkout outside the workspace without explicit
authorization.

Use non-interactive commands: supply commit messages, PR titles and bodies explicitly; prefix Git
commands that could launch an editor with `GIT_EDITOR=true` in a POSIX shell, or use
`git -c core.editor=true` in PowerShell. Preserve signing settings; stop if required signing cannot
run non-interactively.

Stage only explicit in-scope paths or hunks. Follow the existing Conventional Commit style; include
real issue references where relevant, and use `Closes` only for issues the change actually resolves.

### Local verification

Sources of truth:

- `deno.json`, `tasks.verify`: `deno task verify` runs lint, implementation-line quality,
  magic-number and duplicate ratchets, formatting checks, Deno/Svelte checks, Deno and Svelte tests,
  and the frontend build.
- `.husky/pre-commit`: commit-time verification runs `npx lint-staged` followed by
  `deno task verify`.
- `.lintstagedrc.json`: staged TypeScript, JavaScript, Svelte, JSON, CSS and Markdown files are
  formatted with `deno fmt`.
- `package.json`, `scripts.prepare`: `npm ci` installs dependencies and initializes Husky.
  `.github/workflows/ci.yml` uses this exact installation command before verification.

Run verification against the isolated candidate, not a checkout containing unrelated modifications.
Ensure the existing pre-commit procedure is active. If hooks are inactive, perform the same
`npx lint-staged` and `deno task verify` steps explicitly; do not use hook bypass settings. Inspect
formatting changes and the staged diff afterward so the committed content is exactly what was
verified. Reverify any later edits or conflict resolutions.

CI uses Node 22 and Deno 2.9.3 (`.github/workflows/ci.yml`, setup steps). Check the current workflow
in case versions changed. Prefer matching runtimes. If local versions differ, report the versions
and do not describe a local pass as CI-equivalent. A failed or unavailable mandatory local check
blocks landing; report the concrete tooling or runtime blocker rather than disabling verification.
Do not install tools outside the workspace without authorization.

Keep additional local tests proportional to the change. Documentation-only work does not require
extra UI or mutation runs locally, but the existing commit-time verification remains applicable and
remote CI is still required. Weekly coverage, visual, and full mutation audits
(`.github/workflows/quality-weekly.yml`) are not ordinary PR gates unless current policy or
destination settings make them applicable.

Completion: only requested changes are committed and all applicable local checks passed on their
final content.

## 3. Publish and review

Push the dedicated branch normally to `origin`; never force-push. Inspect the complete
destination-relative diff before publication. Create or reuse the matching PR with explicit
destination and head:

```sh
gh pr create --repo asadaame5121/Radiora --base main --head "$branch" --title "$title" --body "$body"
```

The PR body must describe scope, behavior, actual verification results and runtime differences, and
relevant issue references. Follow any current submission template or applicable authorship policy.

Review the full PR diff against project standards and the originating task. Resolve actionable
findings before landing. Honor required external reviews; never manufacture approval, approve one's
own PR to satisfy a rule, or ignore unresolved blocking feedback.

Completion: a PR exists containing exactly the requested change, its review is complete, and
applicable review requirements are met.

## 4. Verify the final PR revision

Read PR metadata, including `headRefOid`, `baseRefOid`, `reviewDecision`, `mergeable`,
`mergeStateStatus`, and `statusCheckRollup`:

```sh
gh pr view "$pr" --repo asadaame5121/Radiora --json headRefOid,baseRefOid,reviewDecision,mergeable,mergeStateStatus,statusCheckRollup
gh pr checks "$pr" --repo asadaame5121/Radiora --json name,state,bucket,workflow,link
```

Check all normal CI jobs, not just `gh pr checks --required`; the server may enforce fewer checks
than this workflow requires. At installation, normal CI contains these jobs
(`.github/workflows/ci.yml`):

- `verify`: Format, check, test, and build.
- `duplicates`: Duplicate-code SARIF.
- `static-analysis`: Opengrep and secret scanning.
- `a11y`: Application interactions and WCAG A/AA, including Storybook.
- `mutation-preflight`: parsers, projections, domain, storage, and controllers.

Reconcile this list with the current CI definition and current destination rules. Verify every
applicable job exists and completed successfully for the current PR head or its current GitHub
test-merge revision. Use check links and Actions run metadata to establish revision identity when
needed. Old push runs or checks for an earlier head are insufficient.

All required checks and these normal CI jobs must pass before landing. Pending, failing, missing,
cancelled, skipped, or unverifiable required jobs are blockers. Do not treat an empty required-check
list as success. Bound watching commands with terminal timeouts; if results are still pending,
report that the changes have not landed and leave the PR intact.

If the base advances and invalidates verification or applicable rules require an up-to-date branch,
merge the fetched destination into the topic branch without rewriting published history, publish
normally, and verify the new revision again.

### Conflict preference

Resolve conflicts automatically when the intended result is clear. Preserve both intended changes
and unrelated work; do not invent new behavior. If intent is ambiguous or resolution would damage
other work, stop and describe the conflict for the user. After resolution, inspect the diff, repeat
mandatory local checks, publish the new commit, and require fresh remote checks.

Completion: review and every applicable check passed for the exact revision to be merged, and the PR
is mergeable.

## 5. Land and verify the destination

Re-read the PR head and destination settings immediately before merging. Pin the head SHA to prevent
merging an unverified later change:

```sh
gh pr merge "$pr" --repo asadaame5121/Radiora --squash --match-head-commit "$verified_head"
```

Use squash only when current settings permit it. If the destination requires a merge queue, follow
its supported queue operation and verify queue checks and actual merge completion. If the default
strategy is disallowed and policy does not identify the alternative, stop and resolve the strategy
rather than guess. Do not use `--admin`, override protections, or change repository rules.

Verify success independently:

```sh
gh pr view "$pr" --repo asadaame5121/Radiora --json state,mergedAt,mergeCommit,baseRefName,url
git fetch origin main
git merge-base --is-ancestor "$merge_commit" origin/main
```

The PR must be `MERGED` into the intended destination and its merge commit must be reachable from
the freshly fetched destination. A published branch, open PR, enabled auto-merge, queued PR, or
running checks is not completion.

Leave source branches and unrelated local work intact. Do not create release tags, publish releases
or packages, or delete branches as part of landing. Release publication is a separate tag-triggered
workflow (`.github/workflows/release.yml`).

Report the PR URL, destination, merge SHA, actual local and remote verification, and any remaining
post-merge checks. If blocked, state explicitly that the changes have not landed and explain the
blocker.
