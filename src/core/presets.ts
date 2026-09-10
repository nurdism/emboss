import type { SignConfig } from './types'

export interface Preset {
  name: string
  /** Settings applied over the current ones. Anything absent is left alone. */
  cfg: Partial<SignConfig>
  /** Icon to load with it, as an Iconify name. Absent leaves artwork alone. */
  icon?: string | null
}

/**
 * Starting points, so the first thing on screen is a sign rather than a blank
 * form. Each one is a small patch over whatever is already set, which keeps a
 * preset from wiping work such as a chosen font.
 */
export const PRESETS: Preset[] = [
  {
    name: 'Door sign',
    cfg: {
      text: 'WORKSHOP',
      plate: 'rounded',
      mode: 'raised',
      autoFit: true,
      padding: 8,
      cornerRadius: 5,
      fontSize: 16,
      baseDepth: 2.4,
      artDepth: 0.8,
      borderWidth: 0,
      holes: 'none',
      baseColor: '#2f3640',
      artColor: '#f5b301',
    },
    icon: null,
  },
  {
    name: 'Keychain',
    cfg: {
      text: 'SPARE',
      plate: 'pill',
      mode: 'inlay',
      autoFit: true,
      padding: 5,
      fontSize: 9,
      baseDepth: 3,
      artDepth: 1,
      borderWidth: 0,
      holes: 'top-center',
      holeDiameter: 4,
      holeInset: 5,
      baseColor: '#1b6ca8',
      artColor: '#f2f4f8',
    },
    icon: null,
  },
  {
    name: 'Warning',
    cfg: {
      text: 'CAUTION',
      plate: 'triangle',
      mode: 'raised',
      autoFit: true,
      padding: 7,
      cornerRadius: 5,
      fontSize: 13,
      baseDepth: 2.4,
      artDepth: 0.8,
      borderWidth: 2.5,
      borderInset: 2,
      holes: 'none',
      svgSize: 22,
      svgPlacement: 'above',
      baseColor: '#f5b301',
      artColor: '#17181b',
    },
    icon: 'mdi:alert',
  },
  {
    name: 'Stop sign',
    cfg: {
      text: 'STOP',
      plate: 'stop',
      mode: 'inlay',
      autoFit: true,
      padding: 6,
      cornerRadius: 0,
      fontSize: 22,
      baseDepth: 2.4,
      artDepth: 0.8,
      borderWidth: 2.5,
      borderInset: 2.5,
      holes: 'none',
      baseColor: '#b62025',
      artColor: '#f2f4f8',
    },
    icon: null,
  },
  {
    name: 'Badge',
    cfg: {
      text: 'K9',
      plate: 'shield',
      mode: 'inlay',
      autoFit: true,
      padding: 7,
      cornerRadius: 4,
      fontSize: 20,
      baseDepth: 3,
      artDepth: 1,
      borderWidth: 2,
      borderInset: 2,
      holes: 'none',
      baseColor: '#243b53',
      artColor: '#d9b310',
    },
    icon: null,
  },
  {
    name: 'QR code',
    cfg: {
      text: 'SCAN ME',
      qrText: 'https://example.com',
      qrEcc: 'M',
      plate: 'rounded',
      mode: 'raised',
      autoFit: true,
      padding: 10,
      cornerRadius: 5,
      fontSize: 9,
      svgSize: 44,
      svgPlacement: 'below',
      svgGap: 4,
      baseDepth: 2.4,
      artDepth: 0.8,
      borderWidth: 0,
      holes: 'none',
      // A code is read as dark on light, so the plate is the pale one here.
      baseColor: '#f2f4f8',
      artColor: '#17181b',
    },
    icon: null,
  },
  {
    name: 'Shelf label',
    cfg: {
      text: 'M3 x 12',
      plate: 'rect',
      mode: 'inlay',
      autoFit: false,
      width: 60,
      height: 16,
      fontSize: 8,
      baseDepth: 2,
      artDepth: 0.6,
      borderWidth: 0,
      holes: 'none',
      baseColor: '#2f3640',
      artColor: '#f2f4f8',
    },
    icon: null,
  },
]
