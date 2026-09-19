import { spawn } from 'node:child_process';

/**
 * Bounded external-process execution.
 *
 * Every external tool (LibreOffice, Poppler, Tesseract) is invoked through this
 * helper: arguments are passed as an array so nothing is shell-interpreted, the
 * process is killed on timeout, and stdout is capped so a runaway tool cannot
 * exhaust the worker's memory.
 */
export interface RunOptions {
  timeoutMs?: number;
  cwd?: string;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
}

export interface RunResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
}

export async function run(
  command: string,
  args: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxOutputBytes = options.maxOutputBytes ?? 256 * 1024 * 1024;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      // Never a shell: arguments are never interpreted.
      shell: false,
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > maxOutputBytes) {
        child.kill('SIGKILL');
        return;
      }
      stdout.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      // Only keep the tail: tool stderr is noisy and rarely useful in full.
      stderr = (stderr + chunk.toString('utf8')).slice(-4_000);
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(stdout), stderr, timedOut });
    });
  });
}

const availability = new Map<string, boolean>();

/** Caches whether an external binary exists, so we probe once per process. */
export async function isAvailable(command: string): Promise<boolean> {
  const cached = availability.get(command);
  if (cached !== undefined) return cached;
  try {
    const result = await run('which', [command], { timeoutMs: 5_000 });
    const found = result.code === 0 && result.stdout.toString().trim().length > 0;
    availability.set(command, found);
    return found;
  } catch {
    availability.set(command, false);
    return false;
  }
}
