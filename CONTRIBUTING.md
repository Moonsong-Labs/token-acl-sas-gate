# Contributing

## PR titles and commit subjects

Use Conventional Commits for both:

```text
<type>[optional scope][!]: <imperative summary>
```

Choose the type that best describes the change:

| Type | Purpose |
| --- | --- |
| `feat` | New behavior or capability |
| `fix` | Correct existing behavior |
| `refactor` | Restructure code without changing behavior |
| `test` | Add or improve tests |
| `docs` | Documentation only |
| `build` | Dependencies, toolchains, or build configuration |
| `ci` | CI workflows |
| `chore` | Maintenance that does not fit another type |

### Writing rules

- Use lowercase types and scopes.
- Omit scope by default. Include it in parentheses only when it identifies a
  meaningful subsystem, such as `program`.
- Use an imperative summary: “add,” “fix,” or “remove,” not “added” or “adds.”
- Start the summary lowercase, omit the trailing period, and aim for a subject
  of 72 characters or fewer, including the type and scope.
- Describe the actual change. Avoid vague subjects such as “update code,”
  “address feedback,” or “misc fixes.”
- Mark breaking changes with `!` immediately before the colon and explain the
  incompatibility in the commit body or PR description. In a commit body, use
  a `BREAKING CHANGE:` footer.
- Each commit describes its own change; the PR title describes the combined
  result. They use the same format but need not have identical wording.

### Examples

```text
feat(program): add minimal Pinocchio entrypoint
test(program): cover empty instruction data
build: update Pinocchio to 0.11.2
docs: document Solana build prerequisites
chore: add PR preparation skill
feat(program)!: require a versioned instruction header
```

## PR descriptions

Keep descriptions concise and factual. Explain what changed, why it changed,
and how it was verified. Include compatibility or migration details when
relevant. Avoid boilerplate, unnecessary narration, and claims of verification
that has not completed.
