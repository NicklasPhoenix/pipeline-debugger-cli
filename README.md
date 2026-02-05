# pipeline-debugger-cli (pdbg)

Run GitHub Actions workflows locally (act) or via GitHub runners, and connect them to the Pipeline Debugger dashboard.

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

## Engines

- **act (default)**: full GitHub Actions support locally (requires `act` + Docker)
- **github**: run on GitHub-hosted runners via `gh` CLI (requires `gh auth login`)
- **builtin**: runs only `run:` steps (fast fallback; `uses:` skipped)

Examples:

```bash
pdbg run .github/workflows/ci.yml --engine act
pdbg run .github/workflows/ci.yml --engine github --repo owner/repo --ref main
pdbg run .github/workflows/ci.yml --engine builtin --image node:20-bullseye
```

## Remote Docker (optional)

If your machine doesn’t have Docker, you can point the CLI to a remote Docker engine:

```bash
pdbg daemon --docker-host tcp://your-host:2376 --docker-tls-verify --docker-cert-path ~/.docker

# or for a one-off run
pdbg run .github/workflows/ci.yml --docker-host tcp://your-host:2376 --docker-tls-verify --docker-cert-path ~/.docker
```

## Notes

- `builtin` engine supports `jobs.<job>.steps[].run` only; `uses:` is skipped.
- `act` engine supports `uses:` and composite actions (requires Docker + act).
- `github` engine runs workflows on GitHub-hosted runners (requires gh auth).

## License

MIT. See `LICENSE`.
