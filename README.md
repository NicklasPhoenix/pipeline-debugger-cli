# pipeline-debugger-cli (pdbg)

Run GitHub Actions workflows locally in Docker and connect them to the Pipeline Debugger dashboard.

## Install

```bash
npm install -g pipeline-debugger-cli
```

## Quickstart

```bash
# (optional) login to the dashboard
pdbg login

# in your repo
pdbg project add
pdbg daemon
```

Open https://pipeline-debugger.vercel.app/dashboard and paste the token printed by `pdbg daemon`.

## Commands

- `pdbg project add [path]` – register a repo (defaults to cwd)
- `pdbg projects` – list projects
- `pdbg daemon` – start local runner API on http://127.0.0.1:17889
- `pdbg run <workflow.yml>` – run a workflow file directly (MVP)

## Notes

- MVP supports only `jobs.<job>.steps[].run` commands.
- `uses:` steps are currently skipped.

## License

MIT. See `LICENSE`.
