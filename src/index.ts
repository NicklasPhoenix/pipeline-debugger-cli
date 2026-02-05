#!/usr/bin/env node

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { runWorkflowFile } from './run.js';
import { getConfig, clearConfig, setToken } from './lib/config.js';
import { deviceLogin } from './lib/device-login.js';
import { ui } from './lib/ui.js';
import { listWorkflows } from './lib/workflows.js';
import { initWorkflow } from './lib/init.js';

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

program.parseAsync(process.argv).catch((err) => {
  ui.error((err as Error).message);
  process.exitCode = 1;
});
