---
name: land
description: >-
  Land team-reviewed work from Delta directly on main with verified checks,
  scoped Conventional Commits, and a normal fast-forward push. Invoke only
  for an explicit landing request or /land, not review, preparation, passing
  checks, or skill installation alone.
metadata:
  delta-action: land
---

# Land team-reviewed work on main

An explicit landing request or `/land` authorizes scoped commits and a normal
fast-forward push to the verified source remote's `main`. Team review happens
in Delta, not GitHub PRs. Do not run this workflow merely to edit or install it.
Never create a PR, force-push, skip hooks, use `--no-verify`, bypass protections,
rewrite published history, or deploy.

## Establish scope, review, and destination

1. Read applicable agent instructions, `CONTRIBUTING.md`, and current hook and
   repository policies. Inspect status, unstaged/staged diffs, relevant untracked
   files, branch history, and `git remote -v`.
2. Identify the team's reviewed, requested scope and evidence of approval in
   Delta. A landing request is not evidence that another reviewer approved the
   change. Ask for review if it is missing or unclear; never fabricate approval.
   Resolve feedback before landing and obtain review for subsequent changes.
3. Verify the source remote's identity and fetch/push URLs; do not assume
   `origin` or hardcode a repository. Never publish to the `local` backlink.
   If only `local` exists, or the destination is ambiguous, stop and ask for the
   intended source remote. Do not invent one.
4. Inspect applicable protections, permissions, required checks, and review
   requirements. Missing policy access is not proof of no restrictions.
   Stop if requirements cannot be verified or direct pushes are prohibited.
   If protections require a PR, report the conflict; do not create a PR or
   weaken protections.

## Prepare a clean, reviewed candidate

1. Fetch the verified remote's `main` and inspect the full outgoing range,
   `<remote>/main..HEAD`, not just the latest commit. Every outgoing commit
   must belong to the reviewed scope; do not push unrelated ancestor commits.
2. Preserve unrelated edits without staging, discarding, or committing them.
   If they prevent a clean candidate, use an isolated worktree based on fetched
   `main` containing only the reviewed work, or stop and ask. Never silently
   stash another participant's changes.
3. Integrate fetched `main` safely. Prefer a fast-forward where possible;
   merge when needed rather than rewriting published history. If the branch
   carries unrelated history, construct a clean candidate from fetched `main`
   using only the intended changes. Ask about ambiguous conflicts; review any
   integration changes and rerun all gates.
4. Review the final working diff for scope, secrets, temporary files, generated
   artifacts, and unintended changes. Stage explicit paths or hunks only.
   Inspect `git diff --cached` before every commit. Make clean, coherent
   Conventional Commits, using non-interactive commands such as
   `GIT_EDITOR=true git commit -m "fix: describe the change"`.

## Mandatory verification

Follow the prerequisites and hook installation in `CONTRIBUTING.md`. Inspect
the current `mise.toml` and `.pre-commit-config.yaml`; hooks are checks, not
automatic fixes. Use the pinned mise environment, not ambient system tools.
If formatting fails, run `mise run fmt` manually and review the resulting
diff before staging. Do not skip checks for documentation-only changes.

Run both final gates on the clean committed candidate:

```sh
mise run check
mise run verify
```

The gates cover formatting, strict Clippy, both host test configurations, and
the ignored validator E2E test, which builds SBF with locked dependencies.
Pre-commit checks also run at pre-push. Missing tools, failed checks, or
unverifiable required checks block landing; host tests do not substitute for
SBF/E2E. `SAS_PROGRAM_SO` can supply a known SAS binary to avoid its mainnet
download. Never claim a check ran when it did not.

## Push and verify

1. Re-fetch `main` immediately before publishing. If it changed, integrate
   safely, re-review the candidate and outgoing range, and rerun both gates.
   Confirm fetched `main` is an ancestor of `HEAD`.
2. Inspect `git log <remote>/main..HEAD`, the cumulative
   `git diff <remote>/main..HEAD`, and status. Require a clean candidate whose
   exact commits and content match what was reviewed and checked. Stop if
   concurrent edits, unexpected commits, or unreviewed changes appear.
3. Record the candidate SHA and publish only with:

   ```sh
   git push <remote> HEAD:refs/heads/main
   ```

   Replace `<remote>` with the verified source remote. Let all hooks run.
   On a non-fast-forward rejection, fetch, integrate, re-review, and rerun
   checks; never force. Other policy or permission failures are blockers,
   not reasons to bypass hooks or protections.
4. Fetch `main` after pushing and verify the remote SHA equals the candidate.
   If it advanced concurrently, verify the candidate is an ancestor of the
   fetched tip and report that distinction. A successful local commit or
   passing check alone is not landing.

Report the verified destination, landed SHA, checks actually run, and any
remaining limitations. If blocked, state what completed, what did not land,
and the specific next action. Do not claim background monitoring or approval.
