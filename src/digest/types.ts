export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: 'ok' | 'retry' | 'fail';
  lastError: string | null;
  // Timestamp strings from the log, retaining their original offsets.
  firstAt: string;
  lastAt: string;
};

export type NightDigest = {
  night: string;
  // One row per job, sorted by job; an empty night has no rows.
  rows: DigestRow[];
  // Malformed lines are skipped and counted without failing the night.
  badLines: number;
  // Job counts by lastStatus; all zero for an empty night.
  counts: Record<DigestRow['lastStatus'], number>;
};

// Read runs/<night>.jsonl synchronously; null means the file is missing.
// Empty files return a digest with empty rows, zero badLines and zero counts.
// Keep rows with missing owners (null); absent last errors are also null.
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
