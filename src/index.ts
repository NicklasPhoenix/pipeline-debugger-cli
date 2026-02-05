#!/usr/bin/env node

import { Command } from 'commander';
import { runWorkflowFile } from './run.js';
import { getConfig, clearConfig, setToken } from './lib/config.js';
import { deviceLogin } from './lib/device-login.js';

const program = new Command();

program
  .name('pipeline-debugger')
  .description('Run GitHub Actions workflows locally in Docker (Pipeline Debugger CLI)')
  .version('0.1.0');

program
  .command('login')
  .description('Authenticate the CLI (device flow via web dashboard)')
  .option('--api <url>', 'Web API base URL', 'https://pipeline-debugger.vercel.app')
  .action(async (opts) => {
    const { token, message } = await deviceLogin({ apiBaseUrl: opts.api });
    setToken(token);
    console.log(message);
  });

program
  .command('logout')
  .description('Clear local credentials')
  .action(() => {
    clearConfig();
    console.log('Logged out (local credentials cleared).');
  });

program
  .command('status')
  .description('Show local CLI auth status')
  .action(() => {
    const cfg = getConfig();
    if (cfg.token) {
      console.log('Authenticated: yes');
      console.log(`Token: ${cfg.token.slice(0, 6)}…${cfg.token.slice(-4)}`);
    } else {
      console.log('Authenticated: no');
      console.log('Run: pdbg login');
    }
  });

program
  .command('run')
  .argument('<workflow.yml>', 'Path to GitHub Actions workflow YAML')
  .description('Run a workflow file locally in Docker')
  .option('--image <image>', 'Docker image to use', 'ubuntu:latest')
  .option('--job <jobId>', 'Job id to run (defaults to first job)')
  .action(async (workflowPath, opts) => {
    const exitCode = await runWorkflowFile({
      workflowPath,
      image: opts.image,
      jobId: opts.job,
    });
    process.exitCode = exitCode;
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
