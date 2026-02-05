# pipeline-debugger-cli (pdbg)

Run GitHub Actions workflows locally in Docker and connect them to the Pipeline Debugger dashboard.

## Install

```bash
npm install -g pipeline-debugger-cli
```

## Quickstart

```bash
# install prerequisites + setup wizard
pdbg setup

# interactive setup wizard (login + project + daemon)
pdbg start

# or step-by-step
pdbg login
pdbg project add
pdbg daemon

# sanity check (with optional auto-fix)
pdbg doctor --fix
```

Open https://pipeline-debugger.vercel.app/dashboard and paste the token printed by `pdbg daemon`.

## Commands

- `pdbg setup` – install prerequisites and run setup wizard
- `pdbg start` – interactive setup wizard
- `pdbg project add [path]` – register a repo (defaults to cwd)
- `pdbg projects` – list projects
- `pdbg daemon` – start local runner API (HTTPS by default)
- `pdbg doctor` – check Docker, auth, and local runner status (`--fix` to install prerequisites)
- `pdbg run <workflow.yml>` – run a workflow file directly

## Notes

- Currently supports `jobs.<job>.steps[].run` commands.
- `uses:` steps are skipped.

## License

MIT. See `LICENSE`.
