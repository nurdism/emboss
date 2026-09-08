import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LinearFilter,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three'

export interface SignSize {
  width: number
  height: number
  depth: number
}

const LINE_COLOUR = 0x8a94a6
const LABEL_SCALE = 0.055

/** Text drawn to a canvas and hung in the scene as a camera facing sprite. */
function label(text: string, pixelHeight = 64): Sprite {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')!
  const font = `600 ${pixelHeight * 0.62}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
  context.font = font
  const width = Math.ceil(context.measureText(text).width) + pixelHeight * 0.7
  canvas.width = width
  canvas.height = pixelHeight
  const ctx = canvas.getContext('2d')!
  ctx.font = font
  ctx.fillStyle = 'rgba(20, 22, 26, 0.85)'
  ctx.fillRect(0, 0, width, pixelHeight)
  ctx.fillStyle = '#dfe4ec'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, width / 2, pixelHeight * 0.55)

  const texture = new CanvasTexture(canvas)
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  const sprite = new Sprite(new SpriteMaterial({ map: texture, depthTest: false, transparent: true }))
  sprite.renderOrder = 10
  return sprite
}

function polyline(points: Vector3[], material: LineBasicMaterial): Line {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(points.flatMap((p) => [p.x, p.y, p.z]), 3),
  )
  return new Line(geometry, material)
}

/**
 * Measurement guides drawn beside the sign: width along the front, height up
 * the right side, and the total build height standing at the corner. Labels are
 * sprites, so they stay upright and readable from any angle.
 */
export class Dimensions extends Group {
  private readonly material = new LineBasicMaterial({
    color: LINE_COLOUR,
    depthTest: false,
    transparent: true,
    opacity: 0.9,
  })

  constructor() {
    super()
    this.renderOrder = 9
  }

  private clearGuides(): void {
    for (const child of [...this.children]) {
      this.remove(child)
      if (child instanceof Line) child.geometry.dispose()
      if (child instanceof Sprite) {
        child.material.map?.dispose()
        child.material.dispose()
      }
    }
  }

  update(size: SignSize): void {
    this.clearGuides()
    const { width, height, depth } = size
    const halfW = width / 2
    const halfH = height / 2
    // Guides sit clear of the sign, scaled so they stay proportionate.
    const gap = Math.max(4, Math.min(width, height) * 0.14)
    const tick = gap * 0.35
    const textScale = Math.max(width, height) * LABEL_SCALE

    const place = (sprite: Sprite, x: number, y: number, z: number, aspect: number) => {
      sprite.position.set(x, y, z)
      sprite.scale.set(textScale * aspect, textScale, 1)
      this.add(sprite)
    }

    // Width, along the front edge.
    const wy = -halfH - gap
    this.add(
      polyline(
        [new Vector3(-halfW, wy, 0), new Vector3(halfW, wy, 0)],
        this.material,
      ),
    )
    for (const x of [-halfW, halfW]) {
      this.add(
        polyline(
          [new Vector3(x, wy - tick / 2, 0), new Vector3(x, -halfH, 0)],
          this.material,
        ),
      )
    }
    const widthText = `${width.toFixed(1)} mm`
    place(label(widthText), 0, wy - tick * 1.6, 0, widthText.length * 0.46)

    // Height, up the right side.
    const hx = halfW + gap
    this.add(
      polyline([new Vector3(hx, -halfH, 0), new Vector3(hx, halfH, 0)], this.material),
    )
    for (const y of [-halfH, halfH]) {
      this.add(
        polyline([new Vector3(hx + tick / 2, y, 0), new Vector3(halfW, y, 0)], this.material),
      )
    }
    const heightText = `${height.toFixed(1)} mm`
    place(label(heightText), hx + tick * 1.9, 0, 0, heightText.length * 0.46)

    // Total build height, standing at the near corner.
    const cx = -halfW - gap
    this.add(
      polyline([new Vector3(cx, -halfH, 0), new Vector3(cx, -halfH, depth)], this.material),
    )
    this.add(
      polyline(
        [new Vector3(cx, -halfH, depth), new Vector3(-halfW, -halfH, depth)],
        this.material,
      ),
    )
    const depthText = `${depth.toFixed(1)} mm`
    place(label(depthText), cx - tick * 1.2, -halfH, depth / 2, depthText.length * 0.46)
  }

  dispose(): void {
    this.clearGuides()
    this.material.dispose()
  }
}
