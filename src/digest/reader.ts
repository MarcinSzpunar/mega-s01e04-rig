import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight } from './types.js';

type RunEvent = {
  at: string;
  job: string;
  status: DigestRow['lastStatus'];
  owner: string | null;
  error?: string;
};

function validNight(night: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return false;
  const date = new Date(`${night}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === night;
}

function isRunEvent(value: unknown): value is RunEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return typeof event.at === 'string'
    && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(event.at)
    && validNight(event.at.slice(0, 10))
    && Number.isFinite(Date.parse(event.at))
    && typeof event.job === 'string' && event.job.trim().length > 0
    && (event.status === 'ok' || event.status === 'retry' || event.status === 'fail')
    && (typeof event.owner === 'string' || event.owner === null)
    && (!('error' in event) || typeof event.error === 'string');
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!validNight(night)) return null;

  let contents: string;
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const digest: NightDigest = {
    night,
    rows: [],
    badLines: 0,
    counts: { ok: 0, retry: 0, fail: 0 },
  };
  const events: RunEvent[] = [];
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      digest.badLines++;
      continue;
    }
    if (isRunEvent(value)) events.push(value);
    else digest.badLines++;
  }

  // Stable sorting makes later log lines win when their instants are equal.
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const jobs = new Map<string, DigestRow>();
  for (const event of events) {
    let row = jobs.get(event.job);
    if (!row) {
      row = {
        job: event.job,
        owner: event.owner,
        runs: 0,
        retries: 0,
        lastStatus: event.status,
        lastError: null,
        firstAt: event.at,
        lastAt: event.at,
      };
      jobs.set(event.job, row);
    }
    row.runs++;
    if (event.status === 'retry') row.retries++;
    row.owner = event.owner;
    row.lastStatus = event.status;
    if (event.error !== undefined) row.lastError = event.error;
    row.lastAt = event.at;
  }

  digest.rows = [...jobs.values()].sort((a, b) => a.job.localeCompare(b.job));
  for (const row of digest.rows) digest.counts[row.lastStatus]++;
  return digest;
};
