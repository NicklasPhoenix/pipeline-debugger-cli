import chalk from 'chalk';
import ora, { Ora } from 'ora';

export const ui = {
  title(text: string) {
    process.stdout.write(`\n${chalk.bold.white(text)}\n`);
  },
  info(text: string) {
    process.stdout.write(`${chalk.cyan('ℹ')} ${text}\n`);
  },
  success(text: string) {
    process.stdout.write(`${chalk.green('✔')} ${text}\n`);
  },
  warn(text: string) {
    process.stdout.write(`${chalk.yellow('⚠')} ${text}\n`);
  },
  error(text: string) {
    process.stderr.write(`${chalk.red('✖')} ${text}\n`);
  },
  spinner(text: string): Ora {
    return ora({ text, color: 'cyan' }).start();
  },
  code(text: string) {
    process.stdout.write(chalk.gray(text) + '\n');
  },
};
