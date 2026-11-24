// 3D preview of a design: one cube per block, colored by block type.
import * as THREE from '../node_modules/three/build/three.module.js'

const NAMED = {
  white: 0xe9ecec, orange: 0xf07613, magenta: 0xbd44b3, light_blue: 0x3aafd9, yellow: 0xf8c527, lime: 0x70b919,
  pink: 0xed8dac, gray: 0x3e4447, light_gray: 0x8e8e86, cyan: 0x158991, purple: 0x792aac, blue: 0x35399d,
  brown: 0x724728, green: 0x546d1b, red: 0xa12722, black: 0x141519
}
const MATERIAL = [
  [/glass/, 0xa8d8ea], [/leaves/, 0x3f7f2a], [/oak_log|spruce_log|birch_log|dark_oak_log|jungle_log|acacia_log|_wood$/, 0x6b5131],
  [/dark_oak/, 0x4a3221], [/spruce/, 0x735432], [/birch/, 0xc4b27a], [/jungle/, 0xa07350], [/acacia/, 0xa95a32],
  [/cherry/, 0xe2b2a8], [/mangrove/, 0x773532], [/bamboo/, 0xc8b54f], [/crimson/, 0x6a344b], [/warped/, 0x2b6963],
  [/oak/, 0xa2834f], [/deepslate/, 0x4d4d51], [/blackstone/, 0x2c272d], [/brick/, 0x8f5a4a], [/sandstone|sand/, 0xd8cb9b],
  [/quartz/, 0xebe5de], [/andesite/, 0x888888], [/diorite/, 0xbdbdbd], [/granite/, 0x956755], [/cobble/, 0x7a7a7a],
  [/stone/, 0x8a8a8a], [/gold/, 0xf6d03d], [/iron/, 0xdcdcdc], [/diamond/, 0x63dbd5], [/emerald/, 0x2ad25b],
  [/lapis/, 0x1f4c9e], [/redstone/, 0xaf1a05], [/coal/, 0x1d1d1d], [/copper/, 0xc06b4f], [/obsidian/, 0x15101e],
  [/snow/, 0xf3fafa], [/ice/, 0x90b4fb], [/glowstone|lantern|shroomlight/, 0xf7d27a], [/bookshelf/, 0x6e5432],
  [/hay/, 0xc29e14], [/mud/, 0x8a6b51], [/prismarine/, 0x5fa595], [/terracotta/, 0x985e43], [/grass/, 0x5d9a3c],
  [/dirt/, 0x866043], [/wool|concrete/, 0xcccccc]
]

export function blockColor (name) {
  const colorKey = Object.keys(NAMED).sort((a, b) => b.length - a.length).find(c => name.startsWith(c + '_'))
  if (colorKey) return NAMED[colorKey]
  for (const [re, c] of MATERIAL) if (re.test(name)) return c
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return new THREE.Color().setHSL((h % 360) / 360, 0.35, 0.55).getHex()
}

export class Preview {
  constructor (canvas) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x1c2027)
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6))
    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    sun.position.set(1, 2, 1.5)
    this.scene.add(sun)
    this.group = new THREE.Group()
    this.scene.add(this.group)
    this.target = new THREE.Vector3()
    this.orbit = { theta: -0.7, phi: 1.05, radius: 50 }
    this.maxLayer = Infinity
    this.meshes = []
    this.bindControls()
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement)
    this.resize()
  }

  bindControls () {
    let dragging = null
    this.canvas.addEventListener('pointerdown', e => { dragging = { x: e.clientX, y: e.clientY }; this.canvas.setPointerCapture(e.pointerId) })
    this.canvas.addEventListener('pointerup', () => { dragging = null })
    this.canvas.addEventListener('pointermove', e => {
      if (!dragging) return
      this.orbit.theta -= (e.clientX - dragging.x) * 0.008
      this.orbit.phi = Math.min(Math.PI - 0.05, Math.max(0.05, this.orbit.phi - (e.clientY - dragging.y) * 0.008))
      dragging = { x: e.clientX, y: e.clientY }
      this.render()
    })
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault()
      this.orbit.radius = Math.min(400, Math.max(5, this.orbit.radius * (e.deltaY > 0 ? 1.1 : 0.9)))
      this.render()
    }, { passive: false })
  }

  resize () {
    const { clientWidth: w, clientHeight: h } = this.canvas.parentElement
    if (!w || !h) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.render()
  }

  show (design) {
    for (const m of this.meshes) { this.group.remove(m); m.geometry.dispose(); m.material.dispose() }
    this.meshes = []
    const byName = new Map()
    for (const [x, y, z, name] of design.blocks) {
      if (!byName.has(name)) byName.set(name, [])
      byName.get(name).push([x, y, z])
    }
    const geo = new THREE.BoxGeometry(1, 1, 1)
    const m4 = new THREE.Matrix4()
    for (const [name, list] of byName) {
      const transparent = /glass|leaves|ice/.test(name)
      const mat = new THREE.MeshLambertMaterial({ color: blockColor(name), transparent, opacity: transparent ? 0.55 : 1 })
      const mesh = new THREE.InstancedMesh(geo, mat, list.length)
      mesh.userData.positions = list
      this.meshes.push(mesh)
      this.group.add(mesh)
    }
    const { x, y, z } = design.size
    // Front of the build (z = 0) faces the camera's starting side.
    // (design z goes away from the viewer, which is -z in three.js)
    this.group.position.set(-x / 2 + 0.5, 0.5, z / 2 - 0.5)
    this.target.set(0, y / 2, 0)
    this.orbit.radius = Math.max(x, y, z) * 2.1 + 6
    this.orbit.theta = 0.6
    this.maxLayer = Infinity
    this.applyLayers(m4)
    const ground = new THREE.GridHelper(Math.max(x, z) + 8, Math.max(x, z) + 8, 0x3b4452, 0x2a313b)
    ground.position.y = 0
    this.scene.remove(this.ground)
    this.ground = ground
    this.scene.add(ground)
    this.render()
  }

  setMaxLayer (n) { this.maxLayer = n; this.applyLayers(); this.render() }

  applyLayers (m4 = new THREE.Matrix4()) {
    for (const mesh of this.meshes) {
      let i = 0
      for (const [x, y, z] of mesh.userData.positions) {
        if (y >= this.maxLayer) continue
        m4.makeTranslation(x, y, -z)
        mesh.setMatrixAt(i++, m4)
      }
      mesh.count = i
      mesh.instanceMatrix.needsUpdate = true
    }
  }

  render () {
    const { theta, phi, radius } = this.orbit
    this.camera.position.set(
      this.target.x + radius * Math.sin(phi) * Math.sin(theta),
      this.target.y + radius * Math.cos(phi),
      this.target.z + radius * Math.sin(phi) * Math.cos(theta)
    )
    this.camera.lookAt(this.target)
    this.renderer.render(this.scene, this.camera)
  }
}
