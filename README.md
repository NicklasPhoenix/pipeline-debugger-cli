# pipeline-debugger-cli

Run GitHub Actions workflows locally in Docker.

## Install (dev)

```bash
npm install
npm run build
npm link
```

## Usage

```bash
pdbg status
pdbg run .github/workflows/ci.yml
pdbg run workflow.yml --image ubuntu:latest
```

## Notes

- MVP supports only `jobs.<job>.steps[].run` commands.
- `uses:` steps are skipped (logged as a warning).
- `login/logout/status` exist but login is a placeholder until web device flow is wired up.
