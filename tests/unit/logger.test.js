import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { log, requestIdFor } from '../../src/server/logger.js';

describe('logger', () => {
  let stdoutWrite;
  let stderrWrite;
  let stdoutLines;
  let stderrLines;

  beforeEach(() => {
    stdoutLines = [];
    stderrLines = [];
    stdoutWrite = process.stdout.write.bind(process.stdout);
    stderrWrite = process.stderr.write.bind(process.stderr);
    process.stdout.write = (line) => { stdoutLines.push(String(line)); return true; };
    process.stderr.write = (line) => { stderrLines.push(String(line)); return true; };
  });

  afterEach(() => {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  });

  it('emits a single-line JSON record with ts, level, msg, context', () => {
    log.info('recipes.list', { requestId: 'req-1', count: 5 });
    expect(stdoutLines).toHaveLength(1);
    const record = JSON.parse(stdoutLines[0]);
    expect(record.level).toBe('info');
    expect(record.msg).toBe('recipes.list');
    expect(record.requestId).toBe('req-1');
    expect(record.count).toBe(5);
    expect(record.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('routes error-level writes to stderr', () => {
    log.error('notion.failed', { requestId: 'req-2' }, new Error('boom'));
    expect(stdoutLines).toHaveLength(0);
    expect(stderrLines).toHaveLength(1);
    const record = JSON.parse(stderrLines[0]);
    expect(record.level).toBe('error');
    expect(record.err.name).toBe('Error');
    expect(record.err.message).toBe('boom');
    expect(record.err.stack).toBeTruthy();
  });

  it('serializes a string error into {message}', () => {
    log.warn('odd', {}, 'just a string');
    const record = JSON.parse(stdoutLines[0]);
    expect(record.err).toEqual({ message: 'just a string' });
  });

  it('truncates stack to ~6 lines to keep log cost bounded', () => {
    const err = new Error('x');
    // Overwrite with a 50-line stack
    err.stack = Array.from({ length: 50 }, (_, i) => `  at line${i}`).join('\n');
    log.error('deep', {}, err);
    const record = JSON.parse(stderrLines[0]);
    expect(record.err.stack.split('\n').length).toBe(6);
  });

  it('writes four levels: debug, info, warn, error', () => {
    log.debug('d'); log.info('i'); log.warn('w'); log.error('e');
    expect(stdoutLines).toHaveLength(3); // debug/info/warn
    expect(stderrLines).toHaveLength(1); // error
    const levels = [...stdoutLines, ...stderrLines].map((l) => JSON.parse(l).level);
    expect(levels.sort()).toEqual(['debug', 'error', 'info', 'warn']);
  });
});

describe('requestIdFor', () => {
  it('prefers explicit x-request-id header', () => {
    const req = { headers: { 'x-request-id': 'abc-123' } };
    expect(requestIdFor(req)).toBe('abc-123');
  });

  it('falls back to x-vercel-id', () => {
    const req = { headers: { 'x-vercel-id': 'iad1::xyz' } };
    expect(requestIdFor(req)).toBe('iad1::xyz');
  });

  it('mints a fresh id when no header present', () => {
    const req = { headers: {} };
    const id = requestIdFor(req);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(8);
  });

  it('handles req without headers', () => {
    const id = requestIdFor(undefined);
    expect(typeof id).toBe('string');
  });
});
