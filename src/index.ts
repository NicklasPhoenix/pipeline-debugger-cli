#!/usr/bin/env node

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import Docker from 'dockerode';
import { runWorkflowFile } from './run.js';
import { getConfig, clearConfig, setToken } from './lib/config.js';
import { deviceLogin } from './lib/device-login.js';
import { ui } from './lib/ui.js';
import { listWorkflows } from './lib/workflows.js';
import { initWorkflow } from './lib/init.js';
import { startDaemon } from './lib/daemon.js';
import { addProject, listProjects, removeProject, selectProject } from './lib/projects.js';

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
      try {
        const srv = await startDaemon({ host, port });
        ui.success(`Local runner listening on http://${srv.host}:${srv.port}`);
        ui.code(`Token (dashboard): ${srv.token}`);
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
  .option('--daemon <url>', 'Local daemon URL', 'http://127.0.0.1:17889')
  .option('--remote', 'Verify token with web API')
  .action(async (opts) => {
    ui.title('Doctor');
    const cfg = getConfig();

    if (cfg.token) {
      ui.success('Auth token present');
    } else {
      ui.warn('Auth token missing');
      ui.code('Run: pdbg login');
    }

    const dockerSpin = ui.spinner('Checking Docker…');
    try {
      const docker = new Docker();
      await docker.ping();
      dockerSpin.succeed('Docker reachable');
    } catch (e) {
      dockerSpin.fail('Docker not reachable');
      ui.error((e as Error).message);
      process.exitCode = 1;
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
  .action(async (opts) => {
    ui.title('Pipeline Debugger — Local Runner');
    const host = String(opts.host ?? '127.0.0.1');
    const port = Number(opts.port ?? 17889);

    const srv = await startDaemon({ host, port });

    ui.success(`Local runner listening on http://${srv.host}:${srv.port}`);
    ui.code(`Token (dashboard): ${srv.token}`);
    ui.info('Tip: register a project with `pdbg project add` so the dashboard can scan workflows.');

    // keep process alive
    await new Promise(() => {});
  });

program.parseAsync(process.argv).catch((err) => {
  ui.error((err as Error).message);
  process.exitCode = 1;
});
