import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import selfsigned from 'selfsigned';

const CERT_DIR = join(homedir(), '.pipeline-debugger', 'certs');
const KEY_PATH = join(CERT_DIR, 'localhost.key');
const CERT_PATH = join(CERT_DIR, 'localhost.crt');

export async function ensureLocalhostCert(): Promise<{ key: string; cert: string }> {
  if (existsSync(KEY_PATH) && existsSync(CERT_PATH)) {
    return {
      key: readFileSync(KEY_PATH, 'utf8'),
      cert: readFileSync(CERT_PATH, 'utf8'),
    };
  }

  mkdirSync(CERT_DIR, { recursive: true });

  const attrs = [{ name: 'commonName', value: 'localhost' }];
  const pems = await selfsigned.generate(attrs, {
    keySize: 2048,
    notAfterDate: new Date(Date.now() + 3650 * 24 * 60 * 60 * 1000),
    extensions: [
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          { type: 7, ip: '::1' },
        ],
      },
    ],
  });

  writeFileSync(KEY_PATH, pems.private, 'utf8');
  writeFileSync(CERT_PATH, pems.cert, 'utf8');

  return { key: pems.private, cert: pems.cert };
}
