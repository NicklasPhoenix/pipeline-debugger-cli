#!/usr/bin/env node

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import Docker from 'dockerode';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { runWorkflowFile } from './run.js';
import { getConfig, clearConfig, setToken } from './lib/config.js';
import { deviceLogin } from './lib/device-login.js';
import { ui } from './lib/ui.js';
import { listWorkflows } from './lib/workflows.js';
import { initWorkflow } from './lib/init.js';
import { startDaemon } from './lib/daemon.js';
import { addProject, listProjects, removeProject, selectProject } from './lib/projects.js';

const exec = promisify(execCb);

function isWsl() {
  return Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
}

function platformLabel() {
  if (isWsl()) return `WSL (${process.env.WSL_DISTRO_NAME ?? 'unknown'})`;
  switch (process.platform) {
    case 'win32':
      return 'Windows';
    case 'darwin':
      return 'macOS';
    default:
      return 'Linux';
  }
}

async function runCmd(cmd: string) {
  try {
    const { stdout, stderr } = await exec(cmd, { timeout: 20000, windowsHide: true });
    return { ok: true, stdout, stderr } as const;
  } catch (e: any) {
    return {
      ok: false,
      stdout: e?.stdout ?? '',
      stderr: e?.stderr ?? '',
      error: e,
    } as const;
  }
}

async function runStartWizard(opts: { api: string; host: string; port: number }) {
  ui.title('Pipeline Debugger Setup');

  const cfg = getConfig();
  if (!cfg.token) {
    const { doLogin } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'doLogin',
        message: 'Authenticate with the dashboard now?',
        default: true,
      },
    ]);
    if (doLogin) {
      const spin = ui.spinner('Starting login…');
      try {
        const { token } = await deviceLogin({ apiBaseUrl: opts.api });
        setToken(token);
        spin.succeed('Logged in successfully');
      } catch (e) {
        spin.fail('Login failed');
        ui.error((e as Error).message);
      }
    }
  } else {
    ui.success('Already authenticated');
  }

  const { addProjectNow } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'addProjectNow',
      message: 'Register a project for the local runner?',
      default: true,
    },
  ]);

  if (addProjectNow) {
    const { path } = await inquirer.prompt([
      {
        type: 'input',
        name: 'path',
        message: 'Project path',
        default: process.cwd(),
      },
    ]);
    try {
      const p = addProject(path);
      ui.success(`Project added: ${p.name}`);
      ui.code(`${p.id}  ${p.rootPath}`);
    } catch (e) {
      ui.error((e as Error).message);
    }
  }

  const { startNow } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'startNow',
      message: 'Start local runner now?',
      default: true,
    },
  ]);

  if (startNow) {
    const host = String(opts.host ?? '127.0.0.1');
    const port = Number(opts.port ?? 17889);
    const { useHttps } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'useHttps',
        message: 'Serve the local runner over HTTPS? (recommended)',
        default: true,
      },
    ]);
    try {
      const srv = await startDaemon({ host, port, https: useHttps });
      const scheme = useHttps ? 'https' : 'http';
      ui.success(`Local runner listening on ${scheme}://${srv.host}:${srv.port}`);
      ui.code(`Token (dashboard): ${srv.token}`);
      if (useHttps) {
        ui.info(`If your browser warns about the certificate, open ${scheme}://${srv.host}:${srv.port}/status once and accept it.`);
      }
      ui.info('Open the dashboard and paste the token to connect.');
      // keep process alive
      await new Promise(() => {});
    } catch (e) {
      ui.error((e as Error).message);
      process.exitCode = 1;
    }
  } else {
    ui.info('You can start the runner later with: pdbg daemon');
  }
}

async function runDoctor(opts: { api: string; daemon: string; remote?: boolean; fix?: boolean }) {
  ui.title('Doctor');
  ui.info(`Platform: ${platformLabel()}`);

  const cfg = getConfig();

  if (cfg.token) {
    ui.success('Auth token present');
  } else {
    ui.warn('Auth token missing');
    ui.code('Run: pdbg login');
  }

  const dockerVersion = await runCmd('docker --version');
  if (!dockerVersion.ok) {
    ui.warn('Docker is not installed');

    if (opts.fix) {
      const { install } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'install',
          message: 'Install Docker prerequisites now? (requires admin rights)',
          default: true,
        },
      ]);

      if (install) {
        if (process.platform === 'win32') {
          const wslStatus = await runCmd('wsl --status');
          if (!wslStatus.ok) {
            const { installWsl } = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'installWsl',
                message: 'WSL not found. Install Ubuntu via WSL now?',
                default: true,
              },
            ]);
            if (installWsl) {
              ui.info('Running: wsl --install -d Ubuntu');
              await runCmd('wsl --install -d Ubuntu');
              ui.warn('WSL install may require a reboot.');
            }
          }

          const winget = await runCmd('winget --version');
          if (winget.ok) {
            const { installDocker } = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'installDocker',
                message: 'Install Docker Desktop via winget?',
                default: true,
              },
            ]);
            if (installDocker) {
              ui.info('Running: winget install -e --id Docker.DockerDesktop');
              await runCmd('winget install -e --id Docker.DockerDesktop');
            }
          } else {
            ui.warn('winget not found. Install Docker Desktop manually: https://www.docker.com/products/docker-desktop/');
          }
        } else if (process.platform === 'darwin') {
          const brew = await runCmd('brew --version');
          if (brew.ok) {
            const { installDocker } = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'installDocker',
                message: 'Install Docker Desktop via Homebrew?',
                default: true,
              },
            ]);
            if (installDocker) {
              ui.info('Running: brew install --cask docker');
              await runCmd('brew install --cask docker');
            }
          } else {
            ui.warn('Homebrew not found. Install Docker Desktop manually: https://www.docker.com/products/docker-desktop/');
          }
        } else {
          ui.warn('Automatic install not supported on Linux. See https://docs.docker.com/engine/install/');
        }
      }
    }
  } else {
    ui.success(dockerVersion.stdout.trim());
    const dockerSpin = ui.spinner('Checking Docker daemon…');
    try {
      const docker = new Docker();
      await docker.ping();
      dockerSpin.succeed('Docker daemon reachable');
    } catch (e) {
      dockerSpin.fail('Docker daemon not reachable');
      ui.error((e as Error).message);
      ui.info('Start Docker Desktop or your Docker daemon, then re-run pdbg doctor.');
      process.exitCode = 1;
    }
  }

  if (cfg.daemonToken) {
    const daemonSpin = ui.spinner('Checking local runner…');
    try {
      const res = await fetch(`${opts.daemon}/status`, {
        headers: { 'X-PDBG-Token': cfg.daemonToken },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Local runner failed (${res.status}): ${text}`);
      }
      daemonSpin.succeed('Local runner OK');
    } catch (e) {
      daemonSpin.fail('Local runner not reachable');
      ui.error((e as Error).message);
      process.exitCode = 1;
    }
  } else {
    ui.warn('Local runner token missing');
    ui.code('Run: pdbg daemon');
  }

  if (opts.remote && cfg.token) {
    const spin = ui.spinner('Checking token with web API…');
    try {
      const res = await fetch(`${opts.api}/api/workflows`, {
        headers: { Authorization: `Bearer ${cfg.token}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Remote auth check failed (${res.status}): ${text}`);
      }
      const data = (await res.json()) as { workflows: unknown[] };
      spin.succeed(`Remote API check OK (workflows: ${data.workflows.length})`);
    } catch (e) {
      spin.fail('Remote API check failed');
      ui.error((e as Error).message);
      process.exitCode = 1;
    }
  }
}

const program = new Command();

program
  .name('pdbg')
  .description('Pipeline Debugger CLI — run GitHub Actions workflows locally in Docker')
  .version('0.1.0');

program
  .command('login')
  .description('Authenticate the CLI (device flow via web dashboard)')
  .option('--api <url>', 'Web API base URL', 'https://pipeline-debugger.vercel.app')
  .action(async (opts) => {
    ui.title('Pipeline Debugger');
    const spin = ui.spinner('Starting login…');
    try {
      const { token } = await deviceLogin({ apiBaseUrl: opts.api });
      setToken(token);
      spin.succeed('Logged in successfully');
      ui.info('Tip: run `pdbg status --remote` to verify.');
    } catch (e) {
      spin.fail('Login failed');
      ui.error((e as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command('logout')
  .description('Clear local credentials')
  .action(() => {
    clearConfig();
    ui.success('Logged out (local credentials cleared).');
  });

program
  .command('start')
  .description('Interactive setup wizard')
  .option('--api <url>', 'Web API base URL', 'https://pipeline-debugger.vercel.app')
  .option('--host <host>', 'Bind host', '127.0.0.1')
  .option('--port <port>', 'Bind port', '17889')
  .action(async (opts) => {
    await runStartWizard({
      api: opts.api,
      host: String(opts.host ?? '127.0.0.1'),
      port: Number(opts.port ?? 17889),
    });
  });

program
  .command('setup')
  .description('Install prerequisites and run the setup wizard')
  .option('--api <url>', 'Web API base URL', 'https://pipeline-debugger.vercel.app')
  .option('--host <host>', 'Bind host', '127.0.0.1')
  .option('--port <port>', 'Bind port', '17889')
  .option('--no-start', 'Skip setup wizard after checks')
  .action(async (opts) => {
    const port = Number(opts.port ?? 17889);
    const daemonUrl = `https://localhost:${port}`;

    await runDoctor({
      api: opts.api,
      daemon: daemonUrl,
      fix: true,
      remote: false,
    });

    if (opts.start === false) return;

    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: 'Continue to interactive setup (login + daemon)?',
        default: true,
      },
    ]);

    if (proceed) {
      await runStartWizard({
        api: opts.api,
        host: String(opts.host ?? '127.0.0.1'),
        port,
      });
    }
  });

program
  .command('status')
  .description('Show local CLI auth status')
  .option('--api <url>', 'Web API base URL', 'https://pipeline-debugger.vercel.app')
  .option('--remote', 'Also verify token by calling the web API')
  .action(async (opts) => {
    const cfg = getConfig();
    if (!cfg.token) {
      ui.warn('Not authenticated');
      ui.code('Run: pdbg login');
      return;
    }

    ui.success('Authenticated');
    ui.code(`Token: ${chalk.gray(cfg.token.slice(0, 6) + '…' + cfg.token.slice(-4))}`);

    if (opts.remote) {
      const spin = ui.spinner('Checking token with web API…');
      try {
        const res = await fetch(`${opts.api}/api/workflows`, {
          headers: { Authorization: `Bearer ${cfg.token}` },
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`Remote auth check failed (${res.status}): ${text}`);
        }
        const data = (await res.json()) as { workflows: unknown[] };
        spin.succeed(`Remote API check OK (workflows: ${data.workflows.length})`);
      } catch (e) {
        spin.fail('Remote API check failed');
        ui.error((e as Error).message);
        process.exitCode = 1;
      }
    }
  });

program
  .command('doctor')
  .description('Check local setup (Docker, auth, daemon)')
  .option('--api <url>', 'Web API base URL', 'https://pipeline-debugger.vercel.app')
  .option('--daemon <url>', 'Local daemon URL', 'https://localhost:17889')
  .option('--remote', 'Verify token with web API')
  .option('--fix', 'Attempt to install missing requirements')
  .action(async (opts) => {
    await runDoctor({
      api: opts.api,
      daemon: opts.daemon,
      remote: opts.remote,
      fix: opts.fix,
    });
  });

program
  .command('run')
  .argument('[workflow.yml]', 'Path to GitHub Actions workflow YAML')
  .description('Run a workflow file locally in Docker')
  .option('--image <image>', 'Docker image to use', 'ubuntu:latest')
  .option('--job <jobId>', 'Job id to run (defaults to first job)')
  .action(async (workflowPath, opts) => {
    try {
      let path = workflowPath as string | undefined;

      if (!path) {
        const ans = await inquirer.prompt([
          {
            type: 'input',
            name: 'path',
            message: 'Workflow YAML path',
            default: '.github/workflows/ci.yml',
          },
        ]);
        path = ans.path;
      }

      ui.title('Run workflow');
      ui.info(`File: ${path}`);
      ui.info(`Image: ${opts.image}`);

      if (!path) throw new Error('Workflow path is required');

      const exitCode = await runWorkflowFile({
        workflowPath: path,
        image: opts.image,
        jobId: opts.job,
      });

      process.exitCode = exitCode;
    } catch (e) {
      ui.error((e as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command('workflows')
  .description('List workflows synced on the dashboard')
  .option('--api <url>', 'Web API base URL', 'https://pipeline-debugger.vercel.app')
  .action(async (opts) => {
    ui.title('Workflows');
    const spin = ui.spinner('Fetching workflows…');
    try {
      const workflows = await listWorkflows({ apiBaseUrl: opts.api });
      spin.stop();
      if (workflows.length === 0) {
        ui.info('No workflows found.');
        return;
      }
      for (const wf of workflows) {
        process.stdout.write(`${chalk.bold.white(wf.name)} ${chalk.gray(wf.id)}\n`);
      }
    } catch (e) {
      spin.fail('Failed to fetch workflows');
      ui.error((e as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command('init')
  .description('Scaffold a starter workflow YAML')
  .option('-o, --out <file>', 'Output file', '.github/workflows/pdbg.yml')
  .action(async (opts) => {
    const spin = ui.spinner(`Writing ${opts.out}…`);
    try {
      await initWorkflow({ outFile: opts.out });
      spin.succeed('Workflow scaffolded');
      ui.code(`Next: pdbg run ${opts.out}`);
    } catch (e) {
      spin.fail('Failed to write workflow');
      ui.error((e as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command('project')
  .description('Manage local projects (repo roots)')
  .command('add')
  .argument('[path]', 'Project root path (defaults to cwd)')
  .action((path) => {
    const p = addProject(path ?? process.cwd());
    ui.success(`Project added: ${p.name}`);
    ui.code(`${p.id}  ${p.rootPath}`);
  });

program
  .command('projects')
  .description('List local projects')
  .action(() => {
    const { projects, activeProjectId } = listProjects();
    if (projects.length === 0) {
      ui.info('No projects registered.');
      ui.code('Run: pdbg project add');
      return;
    }
    for (const p of projects) {
      const active = p.id === activeProjectId ? '*' : ' ';
      process.stdout.write(`${active} ${p.name}  ${p.id}  ${p.rootPath}\n`);
    }
  });

program
  .command('project-select')
  .description('Select active project')
  .argument('<id>', 'Project id')
  .action((id) => {
    const p = selectProject(id);
    ui.success(`Active project: ${p.name}`);
  });

program
  .command('project-rm')
  .description('Remove a project')
  .argument('<id>', 'Project id')
  .action((id) => {
    removeProject(id);
    ui.success('Project removed');
  });

program
  .command('daemon')
  .description('Start local runner API for the web dashboard (localhost)')
  .option('--host <host>', 'Bind host', '127.0.0.1')
  .option('--port <port>', 'Bind port', '17889')
  .option('--https', 'Serve over HTTPS (recommended for dashboard)', true)
  .option('--http', 'Serve over HTTP only (insecure)')
  .action(async (opts) => {
    ui.title('Pipeline Debugger — Local Runner');
    const host = String(opts.host ?? '127.0.0.1');
    const port = Number(opts.port ?? 17889);
    const useHttps = opts.http ? false : Boolean(opts.https ?? true);

    const srv = await startDaemon({ host, port, https: useHttps });

    const scheme = useHttps ? 'https' : 'http';
    ui.success(`Local runner listening on ${scheme}://${srv.host}:${srv.port}`);
    ui.code(`Token (dashboard): ${srv.token}`);
    if (useHttps) {
      ui.info(`If your browser warns about the certificate, open ${scheme}://${srv.host}:${srv.port}/status once and accept it.`);
    }
    ui.info('Tip: register a project with `pdbg project add` so the dashboard can scan workflows.');

    // keep process alive
    await new Promise(() => {});
  });

program.parseAsync(process.argv).catch((err) => {
  ui.error((err as Error).message);
  process.exitCode = 1;
});
