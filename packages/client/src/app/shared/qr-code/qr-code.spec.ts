import { TestBed } from '@angular/core/testing';
import { encode } from 'uqr';
import { describe, expect, it } from 'vitest';

import { QR_QUIET_ZONE, QrCode, drawQrCode, modulesPath } from './qr-code';

/** A room link of the length the lobby encodes. */
const LINK = 'https://battleship-ac7.pages.dev/r/abcdefghijklmnopqrstu';

/**
 * Adds up the widths of the rectangles in a path from `modulesPath`.
 * @param path The path.
 * @returns How many modules the path covers.
 */
function coveredModules(path: string): number {
  return Array.from(path.matchAll(/h(\d+)/g), ([, width]) => Number(width)).reduce((sum, width) => sum + width, 0);
}

describe('modulesPath', () => {
  it('draws one rectangle per run of dark modules', () => {
    const modules = [
      [true, true, false, true],
      [false, false, false, false],
      [false, true, true, true],
    ];

    expect(modulesPath(modules)).toBe('M0 0h2v1h-2zM3 0h1v1h-1zM1 2h3v1h-3z');
  });

  it('draws nothing for a light matrix', () => {
    expect(modulesPath([[false, false]])).toBe('');
  });
});

describe('drawQrCode', () => {
  it('keeps the standard quiet zone around the code', () => {
    const { size } = drawQrCode(LINK);
    const { size: bare } = encode(LINK, { ecc: 'M', border: 0 });

    expect(QR_QUIET_ZONE).toBe(4);
    expect(size).toBe(bare + 2 * QR_QUIET_ZONE);
  });

  it('covers exactly the dark modules of the code', () => {
    const { path } = drawQrCode(LINK);
    const { data } = encode(LINK, { ecc: 'M', border: QR_QUIET_ZONE });

    expect(coveredModules(path)).toBe(data.flat().filter(Boolean).length);
    expect(path).toBe(modulesPath(data));
  });
});

describe('QrCode', () => {
  it('draws the code as an image named by its label', async () => {
    const fixture = TestBed.createComponent(QrCode);
    fixture.componentRef.setInput('value', LINK);
    fixture.componentRef.setInput('label', `QR code of ${LINK}`);
    await fixture.whenStable();

    const svg = (fixture.nativeElement as HTMLElement).querySelector('svg');
    const { size, path } = drawQrCode(LINK);
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe(`QR code of ${LINK}`);
    expect(svg?.getAttribute('viewBox')).toBe(`0 0 ${String(size)} ${String(size)}`);
    expect(svg?.querySelector('path')?.getAttribute('d')).toBe(path);
  });
});
