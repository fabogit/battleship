import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DIE_FLICKER_MS, DIE_PIPS, Die } from './die';

let fixture: ComponentFixture<Die>;

/**
 * Renders the die.
 * @param face The face it stops on.
 * @param isRolling Whether it tumbles.
 */
function render(face: number, isRolling = false): void {
  fixture.componentRef.setInput('face', face);
  fixture.componentRef.setInput('isRolling', isRolling);
  fixture.detectChanges();
}

/** @returns The grid cells holding a pip, numbered 0 to 8 row by row. */
function pips(): number[] {
  const cells = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('span'));
  return cells.flatMap((cell, index) => (cell.classList.contains('pip') ? [index] : []));
}

beforeEach(() => {
  vi.useFakeTimers();
  fixture = TestBed.createComponent(Die);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Die', () => {
  it.each([1, 2, 3, 4, 5, 6])('draws %i as pips, hidden from assistive technologies', (face) => {
    render(face);

    expect(pips()).toEqual(DIE_PIPS[face]);
    expect(pips()).toHaveLength(face);
    expect((fixture.nativeElement as HTMLElement).getAttribute('aria-hidden')).toBe('true');
  });

  it('changes its face while it tumbles, and stops on its own', () => {
    render(4, true);
    expect((fixture.nativeElement as HTMLElement).classList).toContain('is-rolling');

    vi.advanceTimersByTime(DIE_FLICKER_MS);
    fixture.detectChanges();
    expect(pips()).toEqual(DIE_PIPS[5]);

    render(4, false);
    expect(pips()).toEqual(DIE_PIPS[4]);
    expect((fixture.nativeElement as HTMLElement).classList).not.toContain('is-rolling');
    expect(vi.getTimerCount()).toBe(0);
  });
});
