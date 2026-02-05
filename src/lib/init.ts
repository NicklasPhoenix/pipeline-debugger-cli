import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

export async function initWorkflow(params: { outFile: string }) {
  const name = basename(params.outFile).replace(/\.(yml|yaml)$/i, '');

  const content = `name: ${name}

on:
  push:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        run: echo "Checkout not implemented; add your own steps"

      - name: Install deps
        run: npm ci

      - name: Run tests
        run: npm test
`;

  await writeFile(params.outFile, content, 'utf8');
}
