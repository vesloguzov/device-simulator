'use strict';

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

/**
 * PIDs listening on TCP port (Windows netstat). Excludes current process.
 * @param {number} port
 * @returns {Promise<number[]>}
 */
async function findListeningPids(port) {
  const portToken = ':' + String(port);
  let stdout = '';
  try {
    const result = await execFileAsync('netstat', ['-ano', '-p', 'tcp'], {
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });
    stdout = result.stdout || '';
  } catch (err) {
    stdout = (err && err.stdout) || '';
    if (!stdout) return [];
  }

  const pids = new Set();
  for (const line of stdout.split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) continue;
    if (!line.includes(portToken)) continue;
    // Local address must end with :port (avoid matching :39200 etc.)
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const local = parts[1] || '';
    if (!local.endsWith(portToken)) continue;
    const pid = Number(parts[parts.length - 1]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (pid === process.pid) continue;
    pids.add(pid);
  }
  return [...pids];
}

/**
 * Force-kill process by PID (Windows).
 * @param {number} pid
 */
async function killPid(pid) {
  try {
    await execFileAsync('taskkill', ['/F', '/PID', String(pid)], {
      windowsHide: true,
    });
  } catch (_) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (__) {
      /* ignore */
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * If something else is LISTENING on port, kill it and wait briefly.
 * @param {number} port
 * @returns {Promise<number[]>} killed PIDs
 */
async function freePortIfBusy(port) {
  const pids = await findListeningPids(port);
  if (!pids.length) return [];
  for (const pid of pids) {
    await killPid(pid);
  }
  await sleep(400);
  return pids;
}

module.exports = { freePortIfBusy, findListeningPids };
