import Docker from 'dockerode';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type DockerConfig = {
  dockerHost?: string;
  dockerTlsVerify?: boolean;
  dockerCertPath?: string;
  dockerKeyPath?: string;
  dockerCaPath?: string;
};

function normalizeHost(host: string) {
  if (host.startsWith('tcp://')) return 'http://' + host.slice(6);
  return host;
}

export function resolveDockerOptions(cfg?: DockerConfig): Docker.DockerOptions | undefined {
  const dockerHost = cfg?.dockerHost ?? process.env.DOCKER_HOST;
  if (!dockerHost) return undefined;

  if (dockerHost.startsWith('unix://')) {
    return { socketPath: dockerHost.replace('unix://', '') };
  }
  if (dockerHost.startsWith('npipe://')) {
    return { socketPath: dockerHost.replace('npipe://', '') };
  }

  const url = new URL(normalizeHost(dockerHost));
  const protocol = url.protocol.replace(':', '') === 'https' ? 'https' : 'http';
  const port = url.port ? Number(url.port) : protocol === 'https' ? 2376 : 2375;

  const opts: Docker.DockerOptions = {
    host: url.hostname,
    port,
    protocol,
  };

  const tlsVerify = cfg?.dockerTlsVerify ?? process.env.DOCKER_TLS_VERIFY === '1';
  const certPath = cfg?.dockerCertPath ?? process.env.DOCKER_CERT_PATH;

  if (tlsVerify) {
    const certDir = certPath && !certPath.endsWith('.pem') ? certPath : undefined;
    const caPath = cfg?.dockerCaPath ?? (certDir ? join(certDir, 'ca.pem') : undefined);
    const certFile = cfg?.dockerCertPath && cfg.dockerCertPath.endsWith('.pem')
      ? cfg.dockerCertPath
      : (certDir ? join(certDir, 'cert.pem') : undefined);
    const keyFile = cfg?.dockerKeyPath ?? (certDir ? join(certDir, 'key.pem') : undefined);

    if (!caPath && !certFile && !keyFile) {
      throw new Error('Docker TLS verify is enabled but no certs were provided. Set DOCKER_CERT_PATH or --docker-ca-path/--docker-cert-path/--docker-key-path.');
    }

    if (caPath && existsSync(caPath)) opts.ca = readFileSync(caPath);
    if (certFile && existsSync(certFile)) opts.cert = readFileSync(certFile);
    if (keyFile && existsSync(keyFile)) opts.key = readFileSync(keyFile);
  }

  return opts;
}

export function createDocker(cfg?: DockerConfig) {
  const opts = resolveDockerOptions(cfg);
  return opts ? new Docker(opts) : new Docker();
}
