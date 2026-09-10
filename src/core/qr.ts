/**
 * QR codes as sign artwork.
 *
 * The matrix comes from `qrcode-generator`, a small dependency free encoder,
 * and is turned straight into contours, so a code lands in the same millimetre
 * space an icon or an uploaded SVG does. Everything downstream, placement,
 * sizing, rotation, the colour split and the export, then works without knowing
 * a QR code from a drawing of a cat.
 *
 * Two details matter for a code that is going to be printed rather than
 * displayed:
 *
 * - Dark modules are emitted as merged horizontal runs instead of one ring
 *   each, which cuts the ring count by roughly two thirds before the boolean
 *   union in `repair.ts` ever sees them.
 * - Runs are drawn a hair oversize. Modules that meet only at a corner union
 *   into a shape that pinches to a single point, and triangulating one of those
 *   into an inlay pocket left the plate with unpaired edges, so it was no longer
 *   closed. Growing each run by a fiftieth of a module turns every such meeting
 *   into a real overlap, which is far too small to disturb the code's
 *   proportions and is asserted in `scripts/validate.ts` both ways.
 */
import { Vector2 } from 'three'
import qrcode from 'qrcode-generator'
import type { Contour } from './contours'
import { fitArt } from './svg'
import type { SignConfig } from './types'

// Byte mode over UTF-8, which is what scanners assume. The encoder's own
// mapping keeps the low byte of each character, so an accent or an emoji would
// go in mangled. The hook is a documented one, and this is the only module that
// touches the encoder.
const utf8 = new TextEncoder()
qrcode.stringToBytes = (value: string): number[] => Array.from(utf8.encode(value))

/** How far each run grows on every side, as a fraction of a module. */
const BLEED = 0.02

export interface QrArt {
  /** One ring per run of dark modules, sized and placed like any other artwork. */
  contours: Contour[]
  /** Matrix side in modules. The quiet zone is not part of it. */
  modules: number
}

/**
 * Encode text into a QR code at the smallest version that holds it, laid out
 * in millimetres to `cfg.svgSize` and turned by `cfg.svgRotation`.
 *
 * Throws when the text will not fit even at version 40, which is the only way
 * this can fail once the text is non-empty.
 */
export function qrArt(text: string, cfg: SignConfig): QrArt {
  const code = qrcode(0, cfg.qrEcc)
  code.addData(text)
  try {
    // Type number zero above means "pick the smallest version that fits".
    code.make()
  } catch {
    throw new Error(
      'That is too long for a QR code. Shorten the text, or drop the error correction to a lower level.',
    )
  }

  const modules = code.getModuleCount()
  const contours: Contour[] = []

  for (let row = 0; row < modules; row++) {
    let start = -1
    // One column past the end closes a run that reaches the right hand edge.
    for (let col = 0; col <= modules; col++) {
      const dark = col < modules && code.isDark(row, col)
      if (dark && start < 0) start = col
      if (!dark && start >= 0) {
        contours.push(run(start, row, col - start))
        start = -1
      }
    }
  }

  // Row zero is the top of the code, and this space is y-up, so rows run down.
  fitArt(contours, cfg)
  return { contours, modules }
}

/** One run of dark modules as a counter-clockwise ring, grown by the bleed. */
function run(col: number, row: number, length: number): Contour {
  const left = col - BLEED
  const right = col + length + BLEED
  const bottom = -row - 1 - BLEED
  const top = -row + BLEED
  return [
    new Vector2(left, bottom),
    new Vector2(right, bottom),
    new Vector2(right, top),
    new Vector2(left, top),
  ]
}
