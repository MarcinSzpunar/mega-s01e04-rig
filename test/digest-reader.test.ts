import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const event = {
  at: '2026-10-28T23:00:00+01:00', job: 'lane/sync', status: 'ok', owner: 'rook',
};

describe('readNight', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-reader-'));
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  it('aggregates the real fixture into five sorted jobs and counts one bad line', () => {
    const fixtures = fileURLToPath(new URL('../runs/', import.meta.url));
    expect(readNight(fixtures, night)).toEqual({
      night,
      badLines: 1,
      counts: { ok: 4, retry: 0, fail: 1 },
      rows: [
        {
          job: 'digest/render', owner: null, runs: 1, retries: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
        },
        {
          job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3,
          lastStatus: 'ok', lastError: 'upstream 503',
          firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
        },
        {
          job: 'lane/sync', owner: 'rook', runs: 8, retries: 1,
          lastStatus: 'ok', lastError: 'lock held',
          firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00',
        },
        {
          job: 'notes/backup', owner: 'lane-07', runs: 1, retries: 0,
          lastStatus: 'fail', lastError: 'quota exceeded',
          firstAt: '2026-10-29T04:00:01+01:00', lastAt: '2026-10-29T04:00:01+01:00',
        },
        {
          job: 'rig/rotate-logs', owner: 'lane-07', runs: 1, retries: 0,
          lastStatus: 'ok', lastError: null,
          firstAt: '2026-10-28T23:00:02+01:00', lastAt: '2026-10-28T23:00:02+01:00',
        },
      ],
    });
  });

  it('returns null for a missing file or runs directory', () => {
    expect(readNight(runsDir, night)).toBeNull();
    expect(readNight(join(runsDir, 'missing'), night)).toBeNull();
  });

  it.each(['', ' \r\n\t\n'])('returns an empty digest for empty or blank input %j', (contents) => {
    writeFileSync(join(runsDir, `${night}.jsonl`), contents);
    expect(readNight(runsDir, night)).toEqual({
      night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it.each(['nested/../2026-10-28', '2026-1-28', '2026-02-29', '2026-13-01', '2026-04-31', '2026-10-28.jsonl'])(
    'rejects invalid night %j even if its file exists', (invalidNight) => {
      mkdirSync(join(runsDir, 'nested'));
      writeFileSync(join(runsDir, `${invalidNight}.jsonl`), JSON.stringify(event));
      expect(readNight(runsDir, invalidNight)).toBeNull();
    },
  );

  it('accepts a leap-day night', () => {
    writeFileSync(join(runsDir, '2024-02-29.jsonl'), '');
    expect(readNight(runsDir, '2024-02-29')?.night).toBe('2024-02-29');
  });

  it('does not hide file errors other than ENOENT', () => {
    mkdirSync(join(runsDir, `${night}.jsonl`));
    expect(() => readNight(runsDir, night)).toThrow();
  });

  it('counts invalid JSON and invalid event fields, ignoring blank lines', () => {
    const invalid = [
      '{broken', 'null', '[]', '42', '{}',
      JSON.stringify({ ...event, at: 'not a timestamp' }),
      JSON.stringify({ ...event, at: '2026-02-30T00:00:00Z' }),
      JSON.stringify({ ...event, at: '2026-10-28T24:00:00Z' }),
      JSON.stringify({ ...event, at: '2026-10-28T23:00:00' }),
      JSON.stringify({ ...event, at: 123 }),
      JSON.stringify({ ...event, job: '  ' }),
      JSON.stringify({ ...event, job: null }),
      JSON.stringify({ ...event, status: 'unknown' }),
      JSON.stringify({ ...event, owner: undefined }),
      JSON.stringify({ ...event, owner: 42 }),
      JSON.stringify({ ...event, error: null }),
      JSON.stringify({ ...event, error: 42 }),
    ];
    writeFileSync(join(runsDir, `${night}.jsonl`), [
      '', ' \t', ...invalid, JSON.stringify({ ...event, owner: null }), '',
    ].join('\r\n'));
    const digest = readNight(runsDir, night);
    expect(digest?.badLines).toBe(invalid.length);
    expect(digest?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(digest?.rows).toHaveLength(1);
    expect(digest?.rows[0]).toMatchObject({ owner: null, runs: 1, lastError: null });
  });

  it('uses chronological instants for owner, status, errors and times, retaining offsets', () => {
    const events = [
      { ...event, at: '2026-10-28T00:45:00Z', owner: null },
      { ...event, at: '2026-10-28T02:30:00+02:00', status: 'retry', error: 'latest error' },
      { ...event, at: '2026-10-27T23:50:00-00:30', status: 'fail', error: 'old error' },
      { ...event, at: '2026-10-28T03:00:00+03:00', owner: 'first owner' },
      { ...event, job: 'z/retrying', status: 'retry' },
      { ...event, job: 'a/failed', status: 'fail' },
    ];
    writeFileSync(join(runsDir, `${night}.jsonl`), events.map((value) => JSON.stringify(value)).join('\n'));
    const digest = readNight(runsDir, night);
    expect(digest?.badLines).toBe(0);
    expect(digest?.counts).toEqual({ ok: 1, retry: 1, fail: 1 });
    expect(digest?.rows.map((row) => row.job)).toEqual(['a/failed', 'lane/sync', 'z/retrying']);
    expect(digest?.rows[1]).toEqual({
      job: 'lane/sync', owner: null, runs: 4, retries: 1,
      lastStatus: 'ok', lastError: 'latest error',
      firstAt: '2026-10-28T03:00:00+03:00', lastAt: '2026-10-28T00:45:00Z',
    });
  });

  it('lets the later log line win for equal instants and preserves an explicitly empty error', () => {
    writeFileSync(join(runsDir, `${night}.jsonl`), [
      { ...event, status: 'fail', error: 'failed' },
      { ...event, at: '2026-10-28T22:00:00Z', owner: null, error: '' },
    ].map((value) => JSON.stringify(value)).join('\n'));
    expect(readNight(runsDir, night)?.rows[0]).toMatchObject({
      runs: 2, owner: null, lastStatus: 'ok', lastError: '', lastAt: '2026-10-28T22:00:00Z',
    });
  });
});
