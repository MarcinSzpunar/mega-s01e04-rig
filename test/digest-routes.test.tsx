import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NightDigest } from '../src/digest/types.js';

const night = '2026-10-28';
const firstAt = `${night}T01:00:00+02:00`;
const lastAt = `${night}T02:00:00+02:00`;

function entry(
  job: string,
  status: NightDigest['rows'][number]['lastStatus'] = 'ok',
  owner: string | null = 'Ada',
  error?: string,
  at = firstAt,
) {
  return JSON.stringify({ at, job, status, owner, ...(error === undefined ? {} : { error }) });
}

function tableRows(html: string) {
  return (html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) ?? []).filter((row) => /<td\b/.test(row));
}

function cells(row: string) {
  return [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((match) =>
    match[1].replace(/<[^>]*>/g, '').trim(),
  );
}

describe('digest routes', () => {
  let runsDir: string;

  beforeEach(() => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  });

  afterEach(() => {
    rmSync(runsDir, { recursive: true, force: true });
  });

  function app() {
    return createApp({ adapter: 'shim', installed: firstAt, beatEverySeconds: 60, runsDir });
  }

  function writeNight(lines: string[]) {
    writeFileSync(join(runsDir, `${night}.jsonl`), lines.join('\n'));
  }

  it('serves sorted, matching HTML and JSON rows, retaining a null owner', async () => {
    writeNight([
      entry('zeta'),
      entry('alpha', 'retry', null),
      entry('alpha', 'ok', null, undefined, lastAt),
    ]);
    const application = app();
    const htmlResponse = await application.request(`/digest/${night}`);
    const jsonResponse = await application.request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(htmlResponse.headers.get('content-type')).toContain('text/html');
    expect(jsonResponse.status).toBe(200);
    expect(jsonResponse.headers.get('content-type')).toContain('application/json');

    const expected: NightDigest = {
      night,
      rows: [
        { job: 'alpha', owner: null, runs: 2, retries: 1, lastStatus: 'ok', lastError: null, firstAt, lastAt },
        { job: 'zeta', owner: 'Ada', runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstAt, lastAt: firstAt },
      ],
      badLines: 0,
      counts: { ok: 2, retry: 0, fail: 0 },
    };
    const digest: NightDigest = await jsonResponse.json();
    expect(digest).toEqual(expected);
    const rows = tableRows(await htmlResponse.text()).map(cells);
    expect(rows).toHaveLength(digest.rows.length);
    for (const [index, row] of digest.rows.entries()) {
      expect(rows[index]).toEqual(expect.arrayContaining([
        row.job, row.owner ?? '—', String(row.runs), String(row.retries),
        row.lastStatus, row.lastError ?? '—', row.firstAt, row.lastAt,
      ]));
    }
  });

  it.each(['/digest', '/api/digest'])('returns 404 for a missing night at %s', async (route) => {
    const response = await app().request(`${route}/${night}`);
    expect(response.status).toBe(404);
  });

  it('renders nothing ran and returns zero rows and counts for an empty night', async () => {
    writeNight([]);
    const application = app();
    const htmlResponse = await application.request(`/digest/${night}`);
    const jsonResponse = await application.request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    const html = await htmlResponse.text();
    expect(html).toMatch(/nothing ran/i);
    expect(tableRows(html)).toEqual([]);
    const expected: NightDigest = {
      night, rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 },
    };
    expect(await jsonResponse.json()).toEqual(expected);
  });

  it('counts malformed lines while retaining sorted valid jobs on both routes', async () => {
    writeNight([entry('zeta'), '{not json', entry('alpha', 'fail', 'Ada', 'disk full'), 'broken']);
    const application = app();
    const htmlResponse = await application.request(`/digest/${night}`);
    const jsonResponse = await application.request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    const expected: NightDigest = {
      night,
      rows: [
        { job: 'alpha', owner: 'Ada', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'disk full', firstAt, lastAt: firstAt },
        { job: 'zeta', owner: 'Ada', runs: 1, retries: 0, lastStatus: 'ok', lastError: null, firstAt, lastAt: firstAt },
      ],
      badLines: 2,
      counts: { ok: 1, retry: 0, fail: 1 },
    };
    expect(await jsonResponse.json()).toEqual(expected);
    const html = await htmlResponse.text();
    expect(html).toMatch(/(?:2\s+(?:bad|malformed) lines|(?:bad|malformed) lines\s*:?\s*2)/i);
    const rows = tableRows(html).map(cells);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('alpha');
    expect(rows[0]).toContain('disk full');
    expect(rows[1]).toContain('zeta');
  });

  it.each([
    { retries: 2, status: 'ok', highlighted: false },
    { retries: 3, status: 'ok', highlighted: true },
    { retries: 4, status: 'ok', highlighted: true },
    { retries: 0, status: 'fail', highlighted: true },
  ] as const)('marks retries=$retries, lastStatus=$status appropriately', async ({ retries, status, highlighted }) => {
    writeNight([
      ...Array.from({ length: retries }, () => entry('job', 'retry')),
      entry('job', status),
    ]);
    const response = await app().request(`/digest/${night}`);
    expect(response.status).toBe(200);
    const rows = tableRows(await response.text());
    expect(rows).toHaveLength(1);
    expect(/class=["'][^"']*\bwarn\b[^"']*["']/.test(rows[0])).toBe(highlighted);
  });

  it('escapes malicious job, owner and error text in HTML and preserves it in JSON', async () => {
    const job = '<script>alert("job")</script>';
    const owner = '<img src=x onerror="alert(1)">';
    const error = '<svg onload="alert(2)">& failed</svg>';
    writeNight([entry(job, 'fail', owner, error)]);
    const application = app();
    const htmlResponse = await application.request(`/digest/${night}`);
    const jsonResponse = await application.request(`/api/digest/${night}`);
    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    const html = await htmlResponse.text();
    for (const text of [job, owner, error]) {
      expect(html).not.toContain(text);
      expect(html).toContain(text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;').replaceAll('"', '&quot;'));
    }
    expect(html).not.toMatch(/<(?:script|img|svg)\b/i);
    const digest: NightDigest = await jsonResponse.json();
    expect(digest.rows).toHaveLength(1);
    expect(digest.rows[0]).toMatchObject({ job, owner, lastError: error });
  });
});
