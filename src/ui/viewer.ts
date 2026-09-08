import {
  AmbientLight,
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { toBufferGeometry, type SolidMesh } from '../core/mesh'
import { Dimensions, type SignSize } from './dimensions'

export class Viewer {
  private readonly renderer: WebGLRenderer
  private readonly scene = new Scene()
  private readonly camera: PerspectiveCamera
  private readonly controls: OrbitControls
  private readonly signGroup = new Group()
  /** One material per part, reused across rebuilds and keyed by part name. */
  private readonly materials = new Map<string, MeshStandardMaterial>()
  private readonly dimensions = new Dimensions()
  private grid: GridHelper | null = null
  private framed = false
  private direction = new Vector3(0.35, -0.85, 0.65)
  /** Re-reads the container size. Called when the panel is dragged or hidden. */
  readonly resize: () => void

  constructor(container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(this.renderer.domElement)

    this.scene.background = new Color('#14161a')

    this.camera = new PerspectiveCamera(38, 1, 0.5, 4000)
    this.camera.up.set(0, 0, 1)
    this.camera.position.set(90, -120, 90)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08

    this.scene.add(new AmbientLight(0xffffff, 1.5))
    const key = new DirectionalLight(0xffffff, 2.2)
    key.position.set(60, -90, 140)
    this.scene.add(key)
    const fill = new DirectionalLight(0xffffff, 0.9)
    fill.position.set(-120, 70, 60)
    this.scene.add(fill)

    this.scene.add(this.signGroup)
    this.scene.add(this.dimensions)

    this.resize = () => {
      const { clientWidth, clientHeight } = container
      if (clientWidth === 0 || clientHeight === 0) return
      this.renderer.setSize(clientWidth, clientHeight, false)
      this.camera.aspect = clientWidth / clientHeight
      this.camera.updateProjectionMatrix()
    }
    new ResizeObserver(() => this.resize()).observe(container)
    this.resize()

    const tick = () => {
      requestAnimationFrame(tick)
      this.controls.update()
      this.renderer.render(this.scene, this.camera)
    }
    tick()
  }

  setBed(x: number, y: number): void {
    if (this.grid) {
      this.scene.remove(this.grid)
      this.grid.geometry.dispose()
    }
    const size = Math.max(x, y)
    const grid = new GridHelper(size, Math.round(size / 10), 0x3a4150, 0x282d36)
    grid.rotation.x = Math.PI / 2
    grid.position.z = -0.02
    this.scene.add(grid)
    this.grid = grid
  }

  /** Draw or hide the width, height and build height guides. */
  setDimensions(size: SignSize | null): void {
    this.dimensions.visible = size !== null
    if (size) this.dimensions.update(size)
  }

  setGeometry(parts: { name: string; mesh: SolidMesh; color: string }[]): void {
    for (const child of [...this.signGroup.children]) {
      this.signGroup.remove(child)
      if (child instanceof Mesh) (child.geometry as BufferGeometry).dispose()
    }
    for (const part of parts) {
      let material = this.materials.get(part.name)
      if (!material) {
        material = new MeshStandardMaterial({ roughness: 0.6, metalness: 0.02, flatShading: true })
        this.materials.set(part.name, material)
      }
      material.color.set(part.color)
      this.signGroup.add(new Mesh(toBufferGeometry(part.mesh), material))
    }
    if (!this.framed) {
      this.frame()
      this.framed = true
    }
  }

  /** Swing the camera to a fixed angle without changing how much is in view. */
  setView(view: 'top' | 'iso'): void {
    this.direction = view === 'top' ? new Vector3(0, -0.001, 1) : new Vector3(0.35, -0.85, 0.65)
    this.frame()
  }

  /** Pull the camera back so the whole sign is in view. */
  frame(): void {
    const box = new Box3().setFromObject(this.signGroup)
    if (this.dimensions.visible) box.expandByObject(this.dimensions)
    if (box.isEmpty()) return
    const size = box.getSize(new Vector3())
    const center = box.getCenter(new Vector3())
    const radius = Math.max(size.x, size.y, size.z) * 0.75
    const distance = (radius / Math.tan((this.camera.fov * Math.PI) / 360)) * 1.8

    this.controls.target.copy(center)
    this.camera.position.copy(center).add(this.direction.clone().setLength(distance))
    this.camera.near = Math.max(0.1, distance / 200)
    this.camera.far = distance * 20
    this.camera.updateProjectionMatrix()
    this.controls.update()
  }
}
