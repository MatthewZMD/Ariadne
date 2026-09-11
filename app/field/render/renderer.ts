/**
 * The field drawn: white fog with a height-aware falloff and permanent holes
 * where structures have been awakened; a ground that is only legible near
 * the feet; markers, places and termini streamed in around the walker from
 * the glTF library; sleeping structures that wake; Ariadne as a ribbon of
 * light with the fragments she has gathered; the walker's footprints; and
 * the pulse of the call in the fog. Nothing here decides anything; it reads
 * the game each frame.
 */
import * as THREE from "three";
import { ThreadGeometry } from "./thread-geometry.ts";
import { renderPixelRatio } from "../performance.ts";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { FieldGame, FieldEvent } from "../game.ts";
import { PULSE_VISIBLE_RANGE } from "../game.ts";
import { CLEARING_RADIUS, FAMILY_COLOR, type Structure, type StructureFamily } from "../structures.ts";
import { type FieldNode, type FieldWay, type WayMarkerKind, distance } from "../graph.ts";
import type { AriadneBody } from "../ariadne.ts";

export const FOG_COLOR = 0xf4f5f4;
export const FOG_NEAR = 1.5;
export const FOG_FAR_EYE = 14;
export const FOG_FAR_GROUND = 20;
export const MAX_CLEARINGS = 16;
const STREAM_RADIUS = 70;
const MARKER_MODELS: Record<WayMarkerKind, string[]> = { "leaning stones": ["marker-stone-01", "marker-stone-02", "marker-stone-03"], posts: ["marker-post-01", "marker-post-02", "marker-post-03"], stitches: ["marker-stitch-01", "marker-stitch-02"] };
const FLOOR_MODELS: Record<string, string[]> = { "stone dish": ["node-dish-01", "node-dish-02"], pool: ["node-pool-01"], "ring of posts": ["node-post-ring-01"], "terminus-collapse": ["terminus-collapse-01", "terminus-collapse-02"], "terminus-water": ["terminus-water-01"] };

export type RenderFrame = {
  time: number;
  pulse: number;
  voiceLevel: number;
  reducedMotion: boolean;
  quality?: number;
};

/* --------------------------------------------------------------- fog */

const clearingsUniform = { value: new Float32Array(MAX_CLEARINGS * 4) };
const clearingCountUniform = { value: 0 };
const fogFarGroundUniform = { value: FOG_FAR_GROUND };
const fogDensityUniform = { value: 1 };

const FOG_PARS_VERTEX = `#ifdef USE_FOG\n varying float vFogDepth;\n varying vec3 vFogWorld;\n#endif`;
const FOG_VERTEX = `#ifdef USE_FOG\n vFogDepth = - mvPosition.z;\n #ifdef USE_INSTANCING\n  vFogWorld = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;\n #else\n  vFogWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n #endif\n#endif`;
const FOG_PARS_FRAGMENT = `#ifdef USE_FOG\n uniform vec3 fogColor;\n uniform float fogNear;\n uniform float fogFar;\n uniform float uFogFarGround;\n uniform float uFogDensity;\n uniform vec4 uClearings[${MAX_CLEARINGS}];\n uniform int uClearingCount;\n varying float vFogDepth;\n varying vec3 vFogWorld;\n#endif`;
const FOG_FRAGMENT = `#ifdef USE_FOG\n float heightMix = clamp( vFogWorld.y / 2.6, 0.0, 1.0 );\n float farHere = mix( uFogFarGround, fogFar, heightMix ) / max( uFogDensity, 0.2 );\n float clear = 0.0;\n for ( int i = 0; i < ${MAX_CLEARINGS}; i++ ) {\n  if ( i >= uClearingCount ) break;\n  vec4 c = uClearings[ i ];\n  float d = length( vFogWorld.xz - c.xy );\n  clear = max( clear, ( 1.0 - smoothstep( c.z * 0.35, c.z, d ) ) * c.w );\n }\n farHere = mix( farHere, farHere * 2.8, clear );\n float fogFactor = smoothstep( fogNear, farHere, vFogDepth );\n gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );\n#endif`;

/** Give a material the field's fog: height-aware, denser off the line, thinned inside clearings. */
export function applyFieldFog(material: THREE.Material) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uClearings = clearingsUniform;
    shader.uniforms.uClearingCount = clearingCountUniform;
    shader.uniforms.uFogFarGround = fogFarGroundUniform;
    shader.uniforms.uFogDensity = fogDensityUniform;
    shader.vertexShader = shader.vertexShader.replace("#include <fog_pars_vertex>", FOG_PARS_VERTEX).replace("#include <fog_vertex>", FOG_VERTEX);
    shader.fragmentShader = shader.fragmentShader.replace("#include <fog_pars_fragment>", FOG_PARS_FRAGMENT).replace("#include <fog_fragment>", FOG_FRAGMENT);
  };
  material.customProgramCacheKey = () => "field-fog";
  material.needsUpdate = true;
  return material;
}

/* ------------------------------------------------------------ helpers */

function mottleTexture() {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 512;
  const g = canvas.getContext("2d")!;
  g.fillStyle = "#e9e4da"; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 2200; i++) { const shade = 208 + Math.random() * 40 | 0; g.fillStyle = `rgba(${shade},${shade - 4},${shade - 12},${.08 + Math.random() * .12})`; g.beginPath(); g.arc(Math.random() * 512, Math.random() * 512, 6 + Math.random() * 28, 0, 7); g.fill(); }
  for (let i = 0; i < 7000; i++) { const shade = 150 + Math.random() * 60 | 0; g.fillStyle = `rgba(${shade},${shade - 3},${shade - 10},${.04 + Math.random() * .08})`; g.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 2, 1 + Math.random() * 2); }
  const texture = new THREE.CanvasTexture(canvas); texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(50, 50); texture.anisotropy = 4; texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

function softDiscTexture(inner = .0, outer = 1) {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
  const g = canvas.getContext("2d")!;
  const gradient = g.createRadialGradient(64, 64, 64 * inner, 64, 64, 64 * outer);
  gradient.addColorStop(0, "rgba(255,255,255,1)"); gradient.addColorStop(.5, "rgba(255,255,255,.35)"); gradient.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gradient; g.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

function fogPatchTexture() {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
  const g = canvas.getContext("2d")!;
  g.clearRect(0, 0, 256, 256);
  for (let i = 0; i < 40; i++) { const x = 40 + Math.random() * 176, y = 40 + Math.random() * 176, r = 30 + Math.random() * 60; const gradient = g.createRadialGradient(x, y, 0, x, y, r); gradient.addColorStop(0, "rgba(255,255,255,.35)"); gradient.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gradient; g.fillRect(0, 0, 256, 256); }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

type Loaded = { scene: THREE.Group };

/** The ribbon's own material: fades along the tail and within arm's reach of the camera, so a sweep past the eye never fills the screen. */
function ribbonMaterial(color: number, opacity: number, additive = false) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    vertexShader: `varying vec2 vUv; varying vec3 vWorld; void main() { vUv = uv; vec4 world = modelMatrix * vec4( position, 1.0 ); vWorld = world.xyz; gl_Position = projectionMatrix * viewMatrix * world; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv; varying vec3 vWorld; void main() { float tail = smoothstep( 0.0, 0.55, vUv.x ); float near = smoothstep( 0.45, 1.3, distance( vWorld, cameraPosition ) ); gl_FragColor = vec4( uColor, uOpacity * tail * near ); }`,
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide,
  });
}

/** Clone a glTF scene with per-instance materials, fogged. */
function instantiate(source: THREE.Group) {
  const root = source.clone(true);
  const cloned = new Map<THREE.Material, THREE.Material>();
  root.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const clone = (material: THREE.Material) => { let copy = cloned.get(material); if (!copy) { copy = material.clone(); applyFieldFog(copy); cloned.set(material, copy); } return copy; };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
  });
  return root;
}

function setState(root: THREE.Object3D, state: "dormant" | "awake") { root.traverse(node => { if (node.name === "dormant" || node.name === "awake") node.visible = node.name === state; }); }

function materialsNamed(root: THREE.Object3D, pattern: RegExp) {
  const out: THREE.MeshStandardMaterial[] = [];
  root.traverse(node => { const mesh = node as THREE.Mesh; if (!mesh.isMesh) return; for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (pattern.test(material.name) && (material as THREE.MeshStandardMaterial).emissive) out.push(material as THREE.MeshStandardMaterial); });
  return out;
}

/* ----------------------------------------------------------- renderer */

type StructureView = { root: THREE.Group; structure: Structure; dormantEmissive: THREE.MeshStandardMaterial[]; awakeEmissive: THREE.MeshStandardMaterial[]; sprites: THREE.Sprite[]; state: "dormant" | "awake"; flash: number[] };

/** Instance materials are cloned; geometry and textures belong to the model cache. */
function releaseInstance(root: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  root.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
  });
  for (const material of materials) material.dispose();
}

export class FieldRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private readonly game: FieldGame;
  private readonly loader = new GLTFLoader();
  private readonly models = new Map<string, Promise<Loaded | null>>();
  private readonly ground: THREE.Mesh;
  private readonly markerMeshes = new Map<string, THREE.InstancedMesh[]>();
  private readonly floors = new Map<string, THREE.Object3D>();
  private readonly structures = new Map<string, StructureView>();
  private readonly residue: THREE.Points;
  private readonly footprints: THREE.InstancedMesh;
  private readonly clearingDiscs = new Map<string, THREE.Mesh>();
  private readonly pulseSprite: THREE.Sprite;
  private readonly fogPatches: THREE.Sprite[] = [];
  private ribbon: THREE.Mesh | null = null;
  private halo: THREE.Mesh | null = null;
  private readonly head: THREE.Sprite;
  private readonly fragmentGroup = new THREE.Group();
  private readonly fragmentMeshes: THREE.Object3D[] = [];
  private travelling: { mesh: THREE.Object3D; family: StructureFamily } | null = null;
  private lastStreamAt = -Infinity;
  private lastStreamPosition: [number, number] = [Infinity, Infinity];
  private lastFootprintCount = -1;
  private readonly discTexture = softDiscTexture();
  private readonly elementSpriteMaterials = new Map<StructureFamily, THREE.SpriteMaterial>();
  private disposed = false;
  private wakeFlashes: Array<{ position: THREE.Vector3; family: StructureFamily; at: number; sprite: THREE.Sprite }> = [];
  private stopped = false;
  private readonly threadGeometry = new ThreadGeometry();
  private threadUpdatedAt = -Infinity;
  private pixelCheckAt = -Infinity;
  private width = 1;
  private height = 1;
  private streaming = false;
  private streamDirty = true;

  constructor(canvas: HTMLCanvasElement, game: FieldGame) {
    this.game = game;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const fogColor = new THREE.Color(FOG_COLOR);
    this.scene.background = fogColor;
    this.scene.fog = new THREE.Fog(fogColor, FOG_NEAR, FOG_FAR_EYE);
    this.camera = new THREE.PerspectiveCamera(66, 1, .05, 90);
    this.camera.rotation.order = "YXZ";
    this.scene.add(new THREE.HemisphereLight(0xdfe6f0, 0xf6efe4, 1.9));
    const fill = new THREE.DirectionalLight(0xffffff, .3); fill.position.set(3, 6, -2); this.scene.add(fill);

    const groundGeometry = new THREE.PlaneGeometry(200, 200, 1, 1); groundGeometry.rotateX(-Math.PI / 2);
    this.ground = new THREE.Mesh(groundGeometry, applyFieldFog(new THREE.MeshStandardMaterial({ map: mottleTexture(), color: 0xffffff, roughness: 1, metalness: 0 })));
    this.scene.add(this.ground);

    const footGeometry = new THREE.PlaneGeometry(.13, .27); footGeometry.rotateX(-Math.PI / 2);
    this.footprints = new THREE.InstancedMesh(footGeometry, applyFieldFog(new THREE.MeshBasicMaterial({ color: 0xb9b4aa, transparent: true, opacity: .55, depthWrite: false })), 700);
    this.footprints.count = 0; this.footprints.frustumCulled = false; this.footprints.position.y = .01; this.scene.add(this.footprints);

    const residueGeometry = new THREE.BufferGeometry();
    residueGeometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(600 * 3), 3));
    residueGeometry.setAttribute("size", new THREE.Float32BufferAttribute(new Float32Array(600), 1));
    this.residue = new THREE.Points(residueGeometry, new THREE.PointsMaterial({ color: 0xe8c979, size: .22, sizeAttenuation: true, map: this.discTexture, transparent: true, opacity: .85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.residue.frustumCulled = false; this.residue.geometry.setDrawRange(0, 0); this.scene.add(this.residue);

    this.pulseSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.discTexture, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false }));
    this.pulseSprite.visible = false; this.scene.add(this.pulseSprite);

    this.head = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.discTexture, color: 0xfff1c4, transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.head.scale.setScalar(.6); this.head.visible = false; this.scene.add(this.head);
    this.scene.add(this.fragmentGroup);

    const patch = fogPatchTexture();
    for (let i = 0; i < 6; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: patch, color: 0xffffff, transparent: true, opacity: .07, depthWrite: false, fog: false }));
      sprite.scale.set(9, 5, 1); this.fogPatches.push(sprite); this.scene.add(sprite);
    }
    for (const family of Object.keys(FAMILY_COLOR) as StructureFamily[]) this.elementSpriteMaterials.set(family, new THREE.SpriteMaterial({ map: this.discTexture, color: new THREE.Color(FAMILY_COLOR[family]), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    void this.warm();
  }

  /* --------------------------------------------------------- loading */

  private model(id: string) {
    let promise = this.models.get(id);
    if (!promise) { promise = this.loader.loadAsync(`/fog/models/${id}.glb`).then(gltf => ({ scene: gltf.scene })).catch(error => { console.warn("field model unavailable", id, error); return null; }); this.models.set(id, promise); }
    return promise;
  }

  private async warm() {
    const ids = ["marker-stone-01", "marker-stone-02", "marker-stone-03", "marker-post-01", "marker-post-02", "marker-post-03", "marker-stitch-01", "marker-stitch-02", "structure-teaching", "node-dish-01", "node-dish-02", "node-pool-01", "node-post-ring-01", "terminus-collapse-01", "terminus-collapse-02", "terminus-water-01", "fragment-bells"];
    await Promise.all(ids.map(id => this.model(id)));
    this.lastStreamAt = -Infinity;
  }

  resize(width: number, height: number) {
    this.width = width; this.height = height; this.pixelCheckAt = -Infinity;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height); this.camera.updateProjectionMatrix();
  }

  /* -------------------------------------------------------- streaming */

  private async stream() {
    const game = this.game, position = game.walker.position;
    // Ways and their markers, as instances per marker model.
    const counts = new Map<string, THREE.Matrix4[]>();
    const seen = new Set<string>();
    for (const node of game.graph.nodes.values()) {
      if (distance(node.position, position) > STREAM_RADIUS + 50) continue;
      for (const wayId of node.ways) {
        if (seen.has(wayId)) continue; seen.add(wayId);
        const way = game.graph.way(wayId)!;
        for (const marker of way.markers) {
          if (distance(marker.position, position) > STREAM_RADIUS) continue;
          const models = MARKER_MODELS[way.marker];
          const id = models[marker.variant % models.length]!;
          const matrix = new THREE.Matrix4().compose(new THREE.Vector3(marker.position[0], 0, marker.position[1]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), way.marker === "stitches" ? marker.yaw + Math.PI / 2 : marker.yaw), new THREE.Vector3(1, 1, 1));
          (counts.get(id) ?? counts.set(id, []).get(id)!).push(matrix);
        }
      }
    }
    for (const [id, matrices] of counts) {
      let meshes = this.markerMeshes.get(id);
      if (!meshes) {
        const loaded = await this.model(id); if (!loaded || this.disposed) continue;
        meshes = [];
        loaded.scene.updateMatrixWorld(true);
        loaded.scene.traverse(node => {
          const mesh = node as THREE.Mesh; if (!mesh.isMesh) return;
          const material = (Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material).clone() as THREE.MeshStandardMaterial;
          if (/emissive/.test(material.name)) { material.emissiveIntensity = 0; material.emissive = new THREE.Color(0x000000); }
          applyFieldFog(material);
          const geometry = mesh.geometry.clone(); geometry.applyMatrix4(mesh.matrixWorld);
          const instanced = new THREE.InstancedMesh(geometry, material, 512); instanced.count = 0; instanced.frustumCulled = false;
          this.scene.add(instanced); meshes!.push(instanced);
        });
        this.markerMeshes.set(id, meshes);
      }
      const count = Math.min(512, matrices.length);
      for (const mesh of meshes) { for (let i = 0; i < count; i++) mesh.setMatrixAt(i, matrices[i]!); mesh.count = count; mesh.instanceMatrix.needsUpdate = true; }
    }
    for (const [id, meshes] of this.markerMeshes) if (!counts.has(id)) for (const mesh of meshes) mesh.count = 0;

    // Places: floors and termini.
    const wanted = new Set<string>();
    for (const node of game.graph.nodes.values()) {
      if (distance(node.position, position) > STREAM_RADIUS) continue;
      const floor = this.floorKind(node);
      if (!floor) continue;
      wanted.add(node.id);
      if (this.floors.has(node.id)) continue;
      const models = FLOOR_MODELS[floor]!, id = models[node.floorVariant % models.length]!;
      this.floors.set(node.id, new THREE.Group());
      void this.model(id).then(loaded => {
        if (!loaded || this.disposed || !this.floors.has(node.id)) return;
        const root = instantiate(loaded.scene);
        root.position.set(node.position[0], 0, node.position[1]);
        if (floor.startsWith("terminus")) { const way = game.graph.way(node.ways[0]!)!, first = game.graph.markersFrom(way, node.id)[0]!; root.rotation.y = Math.atan2(first.position[0] - node.position[0], first.position[1] - node.position[1]); }
        else root.rotation.y = node.floorYaw;
        this.floors.set(node.id, root); this.scene.add(root);
      });
    }
    for (const [id, object] of this.floors) if (!wanted.has(id)) { this.scene.remove(object); releaseInstance(object); this.floors.delete(id); }

    // Structures.
    const wantedStructures = new Set<string>();
    for (const structure of game.structures.all()) {
      if (distance(structure.position, position) > STREAM_RADIUS) continue;
      wantedStructures.add(structure.id);
      if (this.structures.has(structure.id)) continue;
      const placeholder: StructureView = { root: new THREE.Group(), structure, dormantEmissive: [], awakeEmissive: [], sprites: [], state: "dormant", flash: [] };
      this.structures.set(structure.id, placeholder);
      void this.model(`structure-${structure.family}`).then(loaded => {
        if (!loaded || this.disposed || this.structures.get(structure.id) !== placeholder) return;
        const root = instantiate(loaded.scene);
        root.position.set(structure.position[0], 0, structure.position[1]); root.rotation.y = structure.yaw;
        const view: StructureView = { root, structure, dormantEmissive: materialsNamed(root, /emissive-dormant/), awakeEmissive: materialsNamed(root, /emissive-awake/), sprites: [], state: structure.completedAt !== null ? "awake" : "dormant", flash: structure.elements.map(() => 0) };
        for (const material of [...view.dormantEmissive, ...view.awakeEmissive]) material.userData.baseIntensity = material.emissiveIntensity || 1;
        setState(root, view.state);
        for (const element of structure.elements) {
          const sprite = new THREE.Sprite(this.elementSpriteMaterials.get(structure.family)!.clone());
          sprite.position.set(element.position[0], element.position[1], element.position[2]); sprite.scale.setScalar(.5);
          view.sprites.push(sprite); this.scene.add(sprite);
        }
        this.structures.set(structure.id, view); this.scene.add(root);
      });
    }
    for (const [id, view] of this.structures) if (!wantedStructures.has(id)) { this.scene.remove(view.root); releaseInstance(view.root); for (const sprite of view.sprites) { this.scene.remove(sprite); sprite.material.dispose(); } this.structures.delete(id); }

    // Clearings on the ground.
    for (const clearing of game.clearings()) {
      const key = `${clearing.x},${clearing.z}`;
      if (this.clearingDiscs.has(key)) continue;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(CLEARING_RADIUS * .9, 48), applyFieldFog(new THREE.MeshBasicMaterial({ map: this.discTexture, color: 0xfff7ea, transparent: true, opacity: .35, depthWrite: false })));
      disc.rotation.x = -Math.PI / 2; disc.position.set(clearing.x, .02, clearing.z);
      this.clearingDiscs.set(key, disc); this.scene.add(disc);
    }
    // Her residue on the markers of ways she chose.
    const positions = this.residue.geometry.getAttribute("position") as THREE.BufferAttribute;
    let n = 0;
    for (const [wayId, trace] of game.memory.residue) {
      const way = game.graph.way(wayId); if (!way) continue;
      for (const marker of way.markers) {
        if (n >= 600 || distance(marker.position, position) > STREAM_RADIUS) continue;
        const height = way.marker === "posts" ? 1.05 : way.marker === "stitches" ? .42 : .55;
        positions.setXYZ(n++, marker.position[0], height + .05 * trace.strength, marker.position[1]);
      }
    }
    positions.needsUpdate = true; this.residue.geometry.setDrawRange(0, n);
    (this.residue.material as THREE.PointsMaterial).size = .2;
  }

  private floorKind(node: FieldNode): string | null {
    if (node.floor === "open") return null;
    if (node.floor.startsWith("terminus") && this.game.structures.atNode(node.id)) return (["stone dish", "pool", "ring of posts"] as const)[node.floorVariant % 3];
    return node.floor;
  }

  private updateFootprints() {
    const prints = this.game.memory.footprints;
    if (prints.length === this.lastFootprintCount) return;
    this.lastFootprintCount = prints.length;
    const position = this.game.walker.position;
    const near = prints.filter(print => Math.hypot(print.x - position[0], print.z - position[1]) < 40).slice(-700);
    const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), scale = new THREE.Vector3(1, 1, 1);
    near.forEach((print, index) => { quaternion.setFromAxisAngle(up, print.yaw); matrix.compose(new THREE.Vector3(print.x, 0, print.z), quaternion, scale); this.footprints.setMatrixAt(index, matrix); });
    this.footprints.count = near.length; this.footprints.instanceMatrix.needsUpdate = true;
  }

  /* ----------------------------------------------------------- events */

  handle(event: FieldEvent) {
    if (["commitment", "structure_completed", "stage_advanced"].includes(event.type)) this.streamDirty = true;
    if (event.type === "element_woke") {
      const sprite = new THREE.Sprite(this.elementSpriteMaterials.get(event.family)!.clone());
      sprite.position.set(event.position[0], event.position[1], event.position[2]); sprite.scale.setScalar(.8);
      this.scene.add(sprite);
      this.wakeFlashes.push({ position: sprite.position.clone(), family: event.family, at: performance.now(), sprite });
    } else if (event.type === "structure_completed") {
      const view = this.structures.get(event.structureId);
      if (view) { view.state = "awake"; setState(view.root, "awake"); }
    } else if (event.type === "fragment") {
      void this.model(`fragment-${event.family === "teaching" ? "bells" : event.family}`).then(loaded => {
        if (!loaded || this.disposed) return;
        const mesh = instantiate(loaded.scene); mesh.traverse(node => { const m = node as THREE.Mesh; if (m.isMesh) for (const material of Array.isArray(m.material) ? m.material : [m.material]) (material as THREE.MeshStandardMaterial).fog = false; });
        mesh.scale.setScalar(1.6);
        mesh.position.set(event.from[0], event.from[1], event.from[2]);
        this.scene.add(mesh); this.travelling = { mesh, family: event.family };
      });
    }
  }

  /* ----------------------------------------------------------- render */

  render(frame: RenderFrame) {
    if (this.disposed || this.stopped) return;
    const game = this.game, walker = game.walker, body = game.ariadne;
    const seconds = frame.time / 1000, quality = frame.quality ?? 1;
    if (frame.time - this.pixelCheckAt >= 1000) {
      this.pixelCheckAt = frame.time;
      const ratio = renderPixelRatio(window.devicePixelRatio, this.width, this.height, quality);
      if (Math.abs(this.renderer.getPixelRatio() - ratio) >= .035) this.renderer.setPixelRatio(ratio);
    }
    this.camera.position.set(walker.position[0], 1.62, walker.position[1]);
    this.camera.rotation.set(walker.pitch, walker.yaw + Math.PI, 0, "YXZ");
    // Ground follows in texture-aligned steps so the mottle never swims.
    this.ground.position.set(Math.round(walker.position[0] / 4) * 4, 0, Math.round(walker.position[1] / 4) * 4);

    if (!this.streaming && (this.streamDirty || this.lastStreamAt === -Infinity || distance(this.lastStreamPosition, walker.position) > 6)) {
      this.streamDirty = false; this.streaming = true; this.lastStreamAt = frame.time; this.lastStreamPosition = [...walker.position];
      void this.stream().catch(error => { console.warn("field streaming failed", error); }).finally(() => { this.streaming = false; });
    }
    this.updateFootprints();

    // Fog: denser off the line; clearings as holes.
    fogDensityUniform.value = 1 + .55 * game.offWayFactor;
    const clearings = game.clearings(MAX_CLEARINGS);
    clearings.forEach((clearing, index) => { const age = Math.min(1, (frame.time - clearing.since) / 4000); clearingsUniform.value.set([clearing.x, clearing.z, clearing.radius, age], index * 4); });
    clearingCountUniform.value = clearings.length;
    for (const [key, disc] of this.clearingDiscs) { const clearing = clearings.find(item => `${item.x},${item.z}` === key); (disc.material as THREE.MeshBasicMaterial).opacity = .35 * (clearing ? Math.min(1, (frame.time - clearing.since) / 4000) : 1); }

    // Structures: dormant emissive breathes with the call when calling; attention sprites; awake glow.
    const engaged = game.engagedElement();
    for (const view of this.structures.values()) {
      const calling = game.call.structureId === view.structure.id;
      const breathe = calling ? .25 + frame.pulse * .9 : .22 + Math.sin(seconds * .7 + view.structure.position[0]) * .05;
      for (const material of view.dormantEmissive) material.emissiveIntensity = view.state === "awake" ? 0 : (material.userData.baseIntensity as number) * breathe * 25;
      for (const material of view.awakeEmissive) material.emissiveIntensity = view.state === "awake" ? (material.userData.baseIntensity as number) * (1 + Math.sin(seconds * 1.1) * .08) : 0;
      view.structure.elements.forEach((element, index) => {
        const sprite = view.sprites[index]; if (!sprite) return;
        const material = sprite.material as THREE.SpriteMaterial;
        const attention = element === engaged ? element.attention : element.attention * .6;
        const base = element.active ? .35 : 0;
        material.opacity = Math.min(.7, base * .6 + attention * .45 + (element.engaged ? .06 : 0));
        sprite.scale.setScalar(element.active ? .4 + Math.sin(seconds * 2 + index) * .04 : .3 + attention * .35);
      });
    }
    const nowMs = performance.now();
    this.wakeFlashes = this.wakeFlashes.filter(flash => {
      const t = (nowMs - flash.at) / 1500;
      if (t >= 1) { this.scene.remove(flash.sprite); flash.sprite.material.dispose(); return false; }
      (flash.sprite.material as THREE.SpriteMaterial).opacity = (1 - t) * .6; flash.sprite.scale.setScalar(.6 + t * 2.2); return true;
    });

    // The pulse in the fog at the calling structure.
    if (game.call.position && game.call.distance !== null && game.call.distance <= PULSE_VISIBLE_RANGE * 1.15) {
      const visibility = 1 - THREE.MathUtils.smoothstep(game.call.distance, PULSE_VISIBLE_RANGE * .6, PULSE_VISIBLE_RANGE * 1.15);
      this.pulseSprite.visible = true;
      this.pulseSprite.position.set(game.call.position[0], game.call.position[1] + .6, game.call.position[2]);
      const size = 2.2 + frame.pulse * 2.6;
      this.pulseSprite.scale.set(size, size, 1);
      (this.pulseSprite.material as THREE.SpriteMaterial).opacity = frame.pulse * .3 * visibility * (game.call.proxy ? .6 : 1);
      (this.pulseSprite.material as THREE.SpriteMaterial).color.set(FAMILY_COLOR[game.call.family ?? "bells"]).lerp(new THREE.Color(0xffffff), .25);
    } else this.pulseSprite.visible = false;

    // Drifting fog patches around the walker.
    this.fogPatches.forEach((sprite, index) => {
      const angle = index / this.fogPatches.length * Math.PI * 2 + (frame.reducedMotion ? 0 : seconds * .035) + walker.yaw * 0;
      const radius = 7 + (index % 3) * 2.2;
      const drift = frame.reducedMotion ? 0 : Math.sin(seconds * .21 + index * 1.7) * 1.4;
      sprite.position.set(walker.position[0] + Math.sin(angle) * (radius + drift), 1.4 + Math.sin(seconds * .17 + index) * .3, walker.position[1] + Math.cos(angle) * (radius + drift));
      const detail = THREE.MathUtils.smoothstep(quality, index / 8, (index + 2) / 8);
      sprite.visible = detail > .01;
      (sprite.material as THREE.SpriteMaterial).opacity = detail * (.06 + .03 * Math.sin(seconds * .3 + index * 2) + game.offWayFactor * .05);
    });

    // Ariadne.
    this.drawAriadne(body, frame);

    this.renderer.render(this.scene, this.camera);
  }

  private drawAriadne(body: AriadneBody | null, frame: RenderFrame) {
    if (!body) { this.head.visible = false; if (this.ribbon) this.ribbon.visible = false; if (this.halo) this.halo.visible = false; return; }
    const brightness = body.brightness;
    this.head.visible = true;
    this.head.position.set(body.position[0], body.height, body.position[1]);
    const headDistance = Math.hypot(body.position[0] - this.camera.position.x, body.height - this.camera.position.y, body.position[1] - this.camera.position.z);
    this.head.scale.setScalar(Math.min(1.1, .16 + headDistance * .045) + frame.voiceLevel * .3 + Math.max(0, brightness - 1) * .2);
    (this.head.material as THREE.SpriteMaterial).opacity = (.45 + .3 * Math.min(1, brightness)) * THREE.MathUtils.smoothstep(headDistance, .5, 1.4);
    if (body.trail.length >= 3) {
      if (frame.time - this.threadUpdatedAt >= 1000 / (24 + 36 * (frame.quality ?? 1))) {
        this.threadUpdatedAt = frame.time;
        this.threadGeometry.update(body.trail, { x: body.position[0], y: body.height, z: body.position[1] }, .02 + frame.voiceLevel * .008, .06 + (brightness - 1) * .03);
      }
      if (!this.ribbon) {
        this.ribbon = new THREE.Mesh(this.threadGeometry.core, ribbonMaterial(0xe9d59c, .95));
        this.halo = new THREE.Mesh(this.threadGeometry.halo, ribbonMaterial(0xf6e7b4, .28));
        this.ribbon.frustumCulled = false; this.halo.frustumCulled = false;
        this.ribbon.renderOrder = 5; this.halo.renderOrder = 4;
        this.scene.add(this.ribbon, this.halo);
      }
      this.ribbon.visible = true; this.halo!.visible = true;
      const coreMaterial = this.ribbon.material as THREE.ShaderMaterial, haloMaterial = this.halo!.material as THREE.ShaderMaterial;
      coreMaterial.uniforms.uOpacity!.value = Math.min(1, .65 + .35 * brightness);
      haloMaterial.uniforms.uOpacity!.value = .18 + .14 * brightness + frame.voiceLevel * .15;
      (coreMaterial.uniforms.uColor!.value as THREE.Color).set(0xe9d59c).lerp(new THREE.Color(0xfff1c8), Math.max(0, brightness - 1) * .5);
    }
    // Fragments ride in a slow orbit around her head.
    this.syncFragments(body);
    const seconds = frame.time / 1000;
    this.fragmentMeshes.forEach((mesh, index) => {
      const angle = seconds * (frame.reducedMotion ? .3 : .9) + index / Math.max(1, this.fragmentMeshes.length) * Math.PI * 2;
      const radius = .32 + Math.min(.4, this.fragmentMeshes.length * .04);
      mesh.position.set(body.position[0] + Math.sin(angle) * radius, body.height - .12 + Math.sin(angle * 2) * .07, body.position[1] + Math.cos(angle) * radius);
      mesh.rotation.y = angle * 1.5;
    });
    if (this.travelling && body.pendingFragment) {
      const t = Math.min(1, (frame.time - body.pendingFragment.startedAt) / 1600), ease = t * t * (3 - 2 * t);
      const from = body.pendingFragment.from;
      this.travelling.mesh.position.set(from[0] + (body.position[0] - from[0]) * ease, from[1] + (body.height - from[1]) * ease + Math.sin(t * Math.PI) * .8, from[2] + (body.position[1] - from[2]) * ease);
      this.travelling.mesh.rotation.y = t * 6;
    } else if (this.travelling && !body.pendingFragment) { this.scene.remove(this.travelling.mesh); releaseInstance(this.travelling.mesh); this.travelling = null; }
  }

  private syncFragments(body: AriadneBody) {
    if (this.fragmentMeshes.length === body.fragments.length) return;
    while (this.fragmentMeshes.length > body.fragments.length) { const mesh = this.fragmentMeshes.pop()!; this.scene.remove(mesh); releaseInstance(mesh); }
    for (let i = this.fragmentMeshes.length; i < body.fragments.length; i++) {
      const family = body.fragments[i]!;
      const placeholder = new THREE.Group(); this.fragmentMeshes.push(placeholder); this.scene.add(placeholder);
      void this.model(`fragment-${family === "teaching" ? "bells" : family}`).then(loaded => {
        if (!loaded || this.disposed) return;
        const mesh = instantiate(loaded.scene); mesh.traverse(node => { const m = node as THREE.Mesh; if (m.isMesh) for (const material of Array.isArray(m.material) ? m.material : [m.material]) (material as THREE.MeshStandardMaterial).fog = false; });
        mesh.scale.setScalar(1.3);
        const index = this.fragmentMeshes.indexOf(placeholder); if (index < 0) return;
        this.scene.remove(placeholder); this.fragmentMeshes[index] = mesh; this.scene.add(mesh);
      });
    }
  }

  /** Take a still for tests and the title card: returns a data URL of the current frame. */
  snapshot() { return this.renderer.domElement.toDataURL("image/png"); }

  dispose() {
    this.disposed = true; this.stopped = true;
    this.threadGeometry.dispose();
    this.renderer.dispose();
  }
}

export type { FieldWay };
