import { Component, computed, input } from '@angular/core';
import { encode } from 'uqr';

/** The light margin around the code, in modules: the 4 the QR code standard asks for, so phones find its edges. */
export const QR_QUIET_ZONE = 4;

/** The code drawn by `QrCode`: its width in modules, quiet zone included, and the path of its dark modules. */
export interface QrDrawing {
  /** Width and height in modules. */
  readonly size: number;
  /** An SVG path with one rectangle per run of dark modules in a row, one unit per module. */
  readonly path: string;
}

/**
 * Turns a QR matrix into one SVG path: each run of dark modules in a row becomes one rectangle, so a room link takes a
 * few hundred short commands rather than one element per module.
 * @param modules The matrix, row by row; `true` is a dark module.
 * @returns The path, in module units from the top left corner.
 */
export function modulesPath(modules: readonly (readonly boolean[])[]): string {
  const commands: string[] = [];
  modules.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (row[x] !== true) {
        x += 1;
        continue;
      }
      const start = x;
      while (row[x] === true) {
        x += 1;
      }
      commands.push(`M${String(start)} ${String(y)}h${String(x - start)}v1h-${String(x - start)}z`);
    }
  });
  return commands.join('');
}

/**
 * Encodes text as a QR code drawing, with error correction level M (15 % of the code can be unreadable, e.g. glare on
 * a screen) and the standard quiet zone.
 * @param text The text to encode, e.g. a room link.
 * @returns The drawing.
 */
export function drawQrCode(text: string): QrDrawing {
  const { size, data } = encode(text, { ecc: 'M', border: QR_QUIET_ZONE });
  return { size, path: modulesPath(data) };
}

/**
 * A QR code drawn as an inline SVG from Angular bindings, without `innerHTML` (ADR-0079). It is an image named by
 * `label`, which should hold the encoded text, so a screen reader gets what a camera would.
 */
@Component({
  selector: 'app-qr-code',
  templateUrl: './qr-code.html',
  styleUrl: './qr-code.css',
})
export class QrCode {
  /** The text to encode. */
  readonly value = input.required<string>();
  /** The image's accessible name. */
  readonly label = input.required<string>();

  /** The drawing of `value`. */
  protected readonly drawing = computed(() => drawQrCode(this.value()));
}
