# pipeline-debugger-cli (pdbg)

[![npm version](https://img.shields.io/npm/v/pipeline-debugger-cli.svg)](https://www.npmjs.com/package/pipeline-debugger-cli)
[![npm downloads](https://img.shields.io/npm/dm/pipeline-debugger-cli.svg)](https://www.npmjs.com/package/pipeline-debugger-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Run GitHub Actions workflows locally (act) or via GitHub runners, and connect them to the Pipeline Debugger dashboard for real-time monitoring and debugging.**

---

## 🚀 Why Pipeline Debugger CLI?

Testing GitHub Actions workflows is painful:
- ❌ Push → Wait → Check logs → Fix → Repeat (5-10 min cycles)
- ❌ No local debugging (can't attach breakpoints or inspect state)
- ❌ Limited visibility into what's happening inside workflows

**Pipeline Debugger CLI solves this:**
- ✅ **Run workflows locally in seconds** (using Docker + act)
- ✅ **Real-time dashboard** showing every step, command, and output
- ✅ **Fast iteration** (test changes in <30s instead of 5+ min)
- ✅ **Three execution modes:** local (act), GitHub runners, or builtin (no Docker)

---

## 📦 Install

```bash
npm install -g pipeline-debugger-cli
```

**Requirements:**
- Node.js 18+ (for the CLI)
- Docker (for local workflow execution via `act`)
- Optional: `gh` CLI (for running on GitHub-hosted runners)

---

## ⚡ Quickstart

### 1. Setup (One-Time)

```bash
# Install prerequisites (act, Docker) + setup wizard
pdbg setup
```

This will:
1. Check if Docker is installed (install instructions if not)
2. Install `act` (GitHub Actions runner for Docker)
3. Run interactive setup wizard

### 2. Start the Daemon

```bash
# Interactive setup wizard (login + project + daemon)
pdbg start
```

**Or step-by-step:**

```bash
# 1. Login to Pipeline Debugger dashboard
pdbg login

# 2. Register your project
pdbg project add

# 3. Start the local runner API (HTTPS by default)
pdbg daemon
```

### 3. Open Dashboard

Open https://pipeline-debugger.vercel.app/dashboard and paste the token printed by `pdbg daemon`.

You'll see real-time workflow execution with:
- Step-by-step progress
- Live logs and output
- Command execution details
- Success/failure status

---

## 🎯 Usage Examples

### Run a Workflow Locally (act engine)

```bash
# Run workflow in Docker via act
pdbg run .github/workflows/ci.yml

# Run with specific engine
pdbg run .github/workflows/ci.yml --engine act

# Watch logs in real-time
pdbg run .github/workflows/ci.yml --follow
```

### Run on GitHub Runners (github engine)

```bash
# Run on GitHub-hosted runners (requires gh CLI auth)
pdbg run .github/workflows/ci.yml --engine github --repo owner/repo --ref main
```

### Fast Testing (builtin engine)

```bash
# Run only `run:` steps (no Docker required, fast)
pdbg run .github/workflows/ci.yml --engine builtin --image node:20-bullseye
```

**Note:** `builtin` engine skips `uses:` actions (only runs shell commands). Use for quick testing or when Docker isn't available.

---

## 📚 Commands Reference

### Setup & Management

| Command | Description |
|---------|-------------|
| `pdbg setup` | Install prerequisites (act, Docker) and run setup wizard |
| `pdbg start` | Interactive setup wizard (login + project + daemon) |
| `pdbg login` | Login to Pipeline Debugger dashboard |
| `pdbg project add [path]` | Register a repo (defaults to current directory) |
| `pdbg projects` | List all registered projects |
| `pdbg doctor [--fix]` | Check Docker, auth, and runner status (auto-fix with `--fix`) |

### Workflow Execution

| Command | Description |
|---------|-------------|
| `pdbg run <workflow.yml>` | Run a workflow file directly |
| `pdbg daemon` | Start local runner API (HTTPS by default) |

### Common Flags

| Flag | Description |
|------|-------------|
| `--engine <act\|github\|builtin>` | Choose execution engine (default: `act`) |
| `--repo <owner/repo>` | GitHub repo (required for `github` engine) |
| `--ref <branch>` | Git ref/branch (required for `github` engine) |
| `--image <docker-image>` | Docker image for `builtin` engine (default: `node:20-bullseye`) |
| `--follow` | Stream logs in real-time |
| `--docker-host <url>` | Remote Docker host (e.g., `tcp://host:2376`) |
| `--docker-tls-verify` | Enable TLS verification for remote Docker |
| `--docker-cert-path <path>` | Path to Docker TLS certificates |

---

## 🔧 Execution Engines

Pipeline Debugger CLI supports three execution modes:

### 1. **act** (Default — Full GitHub Actions Support)

- ✅ Full GitHub Actions syntax support (including `uses:` actions)
- ✅ Runs locally in Docker containers
- ✅ Fast iteration (no need to push to GitHub)
- ⚠️ Requires Docker and `act` installed

**Use when:** You want full workflow compatibility and have Docker available.

```bash
pdbg run .github/workflows/ci.yml --engine act
```

### 2. **github** (GitHub-Hosted Runners)

- ✅ Runs on actual GitHub infrastructure
- ✅ Guaranteed compatibility (same environment as CI)
- ✅ No local Docker needed
- ⚠️ Slower (requires push to GitHub + queue time)
- ⚠️ Requires `gh` CLI authentication

**Use when:** You need to test on actual GitHub runners or don't have Docker locally.

```bash
pdbg run .github/workflows/ci.yml --engine github --repo owner/repo --ref main
```

### 3. **builtin** (Fast Fallback)

- ✅ No Docker required
- ✅ Very fast (runs shell commands directly in Node.js)
- ❌ Only supports `run:` steps (`uses:` actions are skipped)

**Use when:** You want quick testing of shell commands without Docker overhead.

```bash
pdbg run .github/workflows/ci.yml --engine builtin --image node:20-bullseye
```

---

## 🌐 Remote Docker Support

If your local machine doesn't have Docker, you can point the CLI to a remote Docker host:

```bash
# Start daemon with remote Docker
pdbg daemon --docker-host tcp://your-host:2376 --docker-tls-verify --docker-cert-path ~/.docker

# Or for a one-off run
pdbg run .github/workflows/ci.yml --docker-host tcp://your-host:2376 --docker-tls-verify --docker-cert-path ~/.docker
```

**Use cases:**
- MacBook with limited resources (use cloud Docker instance)
- Windows machine without Docker Desktop (use Linux server)
- CI/CD pipelines (connect to shared Docker daemon)

---

## 🐛 Troubleshooting

### "Docker not found" Error

**Solution:**
```bash
pdbg doctor --fix
```

This will guide you through installing Docker and `act`.

### "Authentication failed" Error

**Solution:**
```bash
pdbg login
```

Make sure you're logged in to the Pipeline Debugger dashboard.

### Workflow Hangs or Times Out

**Check:**
1. Docker daemon is running: `docker ps`
2. `act` is installed: `which act`
3. Workflow syntax is valid: `act --dryrun -W .github/workflows/ci.yml`

**Workaround:** Try `builtin` engine for faster testing:
```bash
pdbg run .github/workflows/ci.yml --engine builtin
```

### Port Already in Use

The daemon uses port **8443** (HTTPS) by default. If blocked:

```bash
# Check what's using the port
lsof -i :8443

# Kill the process or change port (feature coming soon)
```

---

## 📖 How It Works

1. **CLI** runs your workflow locally (via Docker + `act`) or on GitHub runners
2. **Local API** streams execution data (steps, logs, status) over HTTPS
3. **Dashboard** connects to your local API and displays real-time progress
4. **You** iterate fast without pushing to GitHub

**Flow:**
```
Your Workflow → pdbg run → Docker (act) → Local API (HTTPS) → Dashboard (real-time view)
```

---

## 🆚 Comparison to Alternatives

| Feature | Pipeline Debugger CLI | act (standalone) | GitHub Actions (push) |
|---------|----------------------|------------------|-----------------------|
| **Run workflows locally** | ✅ | ✅ | ❌ |
| **Real-time dashboard** | ✅ | ❌ | ✅ (limited) |
| **Fast iteration** | ✅ (<30s) | ✅ | ❌ (5-10 min) |
| **No Docker required** | ✅ (builtin mode) | ❌ | ✅ |
| **Run on GitHub runners** | ✅ | ❌ | ✅ |
| **Full `uses:` support** | ✅ (act mode) | ✅ | ✅ |
| **Step-by-step visibility** | ✅ | ⚠️ (logs only) | ⚠️ (logs only) |

**TL;DR:** Pipeline Debugger CLI combines the best of `act` (local execution) with a real-time dashboard for better visibility and faster debugging.

---

## 🤝 Contributing

Contributions welcome! Please check the [issues](https://github.com/NicklasPhoenix/pipeline-debugger-cli/issues) page for bugs and feature requests.

**To contribute:**
1. Fork the repo
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit changes (`git commit -m 'Add your feature'`)
4. Push to branch (`git push origin feature/your-feature`)
5. Open a Pull Request

---

## 📄 License

MIT. See [LICENSE](LICENSE).

---

## 🔗 Links

- **npm:** https://www.npmjs.com/package/pipeline-debugger-cli
- **GitHub:** https://github.com/NicklasPhoenix/pipeline-debugger-cli
- **Dashboard:** https://pipeline-debugger.vercel.app
- **Issues:** https://github.com/NicklasPhoenix/pipeline-debugger-cli/issues

---

**Made with ❤️ for developers tired of slow CI feedback loops.**
