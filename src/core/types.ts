export type PlateShape =
  | 'rect'
  | 'rounded'
  | 'square'
  | 'circle'
  | 'ellipse'
  | 'pill'
  | 'triangle'
  | 'hexagon'
  | 'octagon'
  | 'stop'
  | 'shield'

export type ArtMode = 'raised' | 'inlay'

export type HoleMode = 'none' | 'top-center' | 'top-corners' | 'four-corners'

export type Align = 'left' | 'center' | 'right'

/**
 * Two tone puts every raised or inlaid feature on one filament. Per element
 * gives the text, the icon and the border a slot each.
 */
export type ColorMode = 'two-tone' | 'per-element'

export type SvgPlacement = 'above' | 'below' | 'left' | 'right' | 'manual'

export interface SignConfig {
  /** Sign label. Newlines split lines. */
  text: string
  /** Catalog id, either `bundled:Name` or a Google Fonts family id. */
  fontId: string
  fontWeight: number
  fontSize: number
  /** Extra tracking between glyphs, in mm. */
  letterSpacing: number
  /** Baseline-to-baseline distance as a multiple of font size. */
  lineSpacing: number
  align: Align
  textOffsetX: number
  textOffsetY: number

  /** Longest side of the placed SVG art, in mm. */
  svgSize: number
  /** Where the SVG sits relative to the text. */
  svgPlacement: SvgPlacement
  /** Clear space between the SVG and the text, in mm. */
  svgGap: number
  svgOffsetX: number
  svgOffsetY: number
  svgRotation: number

  plate: PlateShape
  /** Size the plate to the artwork instead of using width/height. */
  autoFit: boolean
  padding: number
  width: number
  height: number
  cornerRadius: number

  /** Rim thickness in millimetres. Zero turns the border off. */
  borderWidth: number
  /** Gap between the plate edge and the outside of the rim. */
  borderInset: number

  baseDepth: number
  artDepth: number
  mode: ArtMode

  holes: HoleMode
  holeDiameter: number
  holeInset: number

  colorMode: ColorMode
  baseColor: string
  /** Used for everything raised or inlaid while in two tone mode. */
  artColor: string
  textColor: string
  iconColor: string
  borderColor: string

  /** Segments per bezier when flattening outlines. Higher is smoother. */
  curveSegments: number

  bedX: number
  bedY: number
  name: string
}

export const defaultConfig: SignConfig = {
  text: 'WORKSHOP',
  fontId: 'bundled:DejaVuSans-Bold',
  fontWeight: 700,
  fontSize: 16,
  letterSpacing: 0,
  lineSpacing: 1.25,
  align: 'center',
  textOffsetX: 0,
  textOffsetY: 0,

  svgSize: 20,
  svgPlacement: 'above',
  svgGap: 4,
  svgOffsetX: 0,
  svgOffsetY: 0,
  svgRotation: 0,

  plate: 'rounded',
  autoFit: true,
  padding: 8,
  width: 120,
  height: 40,
  cornerRadius: 5,

  borderWidth: 0,
  borderInset: 2,

  baseDepth: 2.4,
  artDepth: 0.8,
  mode: 'raised',

  holes: 'none',
  holeDiameter: 4,
  holeInset: 6,

  colorMode: 'two-tone',
  baseColor: '#2f3640',
  artColor: '#f5b301',
  textColor: '#f5b301',
  iconColor: '#e8f1f2',
  borderColor: '#d94f30',

  curveSegments: 12,

  bedX: 256,
  bedY: 256,
  name: 'sign',
}
