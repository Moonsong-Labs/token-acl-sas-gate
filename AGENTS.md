# Agent instructions

## Project context and checks

- Read [README.md](README.md) for project behavior, setup, build commands, and
  E2E usage. Follow [CONTRIBUTING.md](CONTRIBUTING.md) for shared review rules,
  required checks, and Conventional Commits.
- Use the pinned environment in [mise.toml](mise.toml), not ambient system
  tools. Run tasks through `mise run` and individual commands through
  `mise exec -- ...`.
- Follow the documented verification requirements. Do not substitute host tests
  for the SBF build or local-validator E2E test, skip hooks, or claim checks
  passed when they did not run.

## Delta checkout setup

Delta runs the executable [.agents/prepare](.agents/prepare) in new managed
checkouts. It requires mise to be installed first, then installs the pinned
tools and runs `mise run setup` to prepare the SBF compiler and Git hooks.
Existing or adopted checkouts still need the setup steps in the README.

## Landing authorization

- Team review happens in Delta. Only an explicit landing request or `/land`
  authorizes creating scoped commits and pushing to `main`. Editing the landing
  skill, asking for review, or passing checks does not authorize publication.
- For an authorized landing, follow the
  [land skill](.agents/skills/land/SKILL.md). Do not run it merely because this
  file references it.
- Preserve unrelated work and publish only the team's reviewed scope. Never
  fabricate approval, invent a source remote, or publish to the `local` backlink.
- If the destination or review status is unclear, ask. If repository protections
  prohibit direct pushes, stop rather than creating a PR or bypassing protections.

## Handoffs

Keep handoffs concise and factual. Explain what changed, why it changed, and
how it was verified. Include compatibility or migration details when relevant.
Avoid boilerplate, unnecessary narration, and claims of verification that has
not completed. Report blockers explicitly and distinguish local changes,
commits, and verified pushes.
