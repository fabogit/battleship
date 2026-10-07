import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';

const ORIGIN = 'http://localhost:4200';

describe('loadConfig', () => {
  it('defaults to port 3000', () => {
    expect(loadConfig({ ALLOWED_ORIGINS: ORIGIN })).toEqual({ port: 3000, allowedOrigins: [ORIGIN], logFormat: 'json', logLevel: 'info' });
  });

  it('reads PORT', () => {
    expect(loadConfig({ PORT: '10000', ALLOWED_ORIGINS: ORIGIN }).port).toBe(10_000);
  });

  it.each(['abc', '-1', '70000', '3.5', '0', '0x10', '1e3', ' 3000'])('rejects PORT=%s', (port) => {
    expect(() => loadConfig({ PORT: port, ALLOWED_ORIGINS: ORIGIN })).toThrow(/Invalid PORT/);
  });

  it('splits, trims and normalizes ALLOWED_ORIGINS', () => {
    const { allowedOrigins } = loadConfig({
      ALLOWED_ORIGINS: ' https://battleship.pages.dev/ , http://localhost:4200,,',
    });
    expect(allowedOrigins).toEqual(['https://battleship.pages.dev', 'http://localhost:4200']);
  });

  it.each([undefined, '', ' ', ',,'])('rejects ALLOWED_ORIGINS=%j and points to .env.example', (origins) => {
    expect(() => loadConfig({ ALLOWED_ORIGINS: origins })).toThrow(/ALLOWED_ORIGINS is not set: .*\.env\.example/);
  });

  it.each(['not a url', 'file:///tmp'])('rejects ALLOWED_ORIGINS=%s', (origins) => {
    expect(() => loadConfig({ ALLOWED_ORIGINS: origins })).toThrow(/Invalid origin/);
  });

  it.each(['json', 'pretty'] as const)('reads LOG_FORMAT=%s', (format) => {
    expect(loadConfig({ ALLOWED_ORIGINS: ORIGIN, LOG_FORMAT: format }).logFormat).toBe(format);
  });

  it.each(['', ' '])('defaults LOG_FORMAT=%j to json', (format) => {
    expect(loadConfig({ ALLOWED_ORIGINS: ORIGIN, LOG_FORMAT: format }).logFormat).toBe('json');
  });

  it.each(['PRETTY', 'text', ' pretty'])('rejects LOG_FORMAT=%s', (format) => {
    expect(() => loadConfig({ ALLOWED_ORIGINS: ORIGIN, LOG_FORMAT: format })).toThrow(/Invalid LOG_FORMAT/);
  });

  it.each(['debug', 'trace', 'silent'] as const)('reads LOG_LEVEL=%s', (level) => {
    expect(loadConfig({ ALLOWED_ORIGINS: ORIGIN, LOG_LEVEL: level }).logLevel).toBe(level);
  });

  it.each(['', ' '])('defaults LOG_LEVEL=%j to info', (level) => {
    expect(loadConfig({ ALLOWED_ORIGINS: ORIGIN, LOG_LEVEL: level }).logLevel).toBe('info');
  });

  it.each(['DEBUG', 'verbose', '20'])('rejects LOG_LEVEL=%s', (level) => {
    expect(() => loadConfig({ ALLOWED_ORIGINS: ORIGIN, LOG_LEVEL: level })).toThrow(/Invalid LOG_LEVEL/);
  });
});
