import * as THREE from "three";

/** Reuses curve samples and GPU buffers for both layers of the thread. */
export class ThreadGeometry {
  readonly core = new THREE.BufferGeometry();
  readonly halo = new THREE.BufferGeometry();
  private readonly samples: THREE.Vector3[];
  private readonly curve = new THREE.CatmullRomCurve3([], false, "centripetal");
  private readonly tangent = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly binormal = new THREE.Vector3();
  private readonly radial = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly side = new THREE.Vector3(1, 0, 0);
  private readonly rings = 6;

  readonly segments: number;
  constructor(segments = 64) {
    this.segments = segments;
    this.samples = Array.from({ length: segments + 1 }, () => new THREE.Vector3());
    const count = (segments + 1) * (this.rings + 1), uv = new Float32Array(count * 2), indices: number[] = [];
    for (let i = 0; i <= segments; i++) for (let j = 0; j <= this.rings; j++) {
      const n = i * (this.rings + 1) + j; uv[n * 2] = i / segments; uv[n * 2 + 1] = j / this.rings;
      if (i && j) { const a = (i - 1) * (this.rings + 1) + j - 1, b = i * (this.rings + 1) + j - 1; indices.push(a, b, a + 1, b, b + 1, a + 1); }
    }
    for (const geometry of [this.core, this.halo]) {
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute("uv", new THREE.BufferAttribute(uv.slice(), 2));
      geometry.setIndex(indices);
    }
  }

  update(trail: Array<{ x: number; y: number; z: number }>, head: { x: number; y: number; z: number }, coreRadius: number, haloRadius: number) {
    const points = this.curve.points;
    while (points.length < trail.length + 1) points.push(new THREE.Vector3());
    points.length = trail.length + 1;
    trail.forEach((point, i) => points[i]!.set(point.x, point.y, point.z));
    points[trail.length]!.set(head.x, head.y, head.z);
    for (let i = 0; i <= this.segments; i++) this.curve.getPoint(i / this.segments, this.samples[i]!);
    const core = this.core.getAttribute("position") as THREE.BufferAttribute, halo = this.halo.getAttribute("position") as THREE.BufferAttribute;
    this.normal.set(0, 1, 0);
    for (let i = 0; i <= this.segments; i++) {
      this.tangent.subVectors(this.samples[Math.min(this.segments, i + 1)]!, this.samples[Math.max(0, i - 1)]!);
      if (this.tangent.lengthSq() < 1e-12) this.tangent.set(0, 0, 1); else this.tangent.normalize();
      this.normal.addScaledVector(this.tangent, -this.normal.dot(this.tangent));
      if (this.normal.lengthSq() < 1e-8) this.normal.crossVectors(this.tangent, Math.abs(this.tangent.y) < .9 ? this.up : this.side);
      this.normal.normalize(); this.binormal.crossVectors(this.tangent, this.normal).normalize();
      const center = this.samples[i]!;
      for (let j = 0; j <= this.rings; j++) {
        const angle = j / this.rings * Math.PI * 2, n = i * (this.rings + 1) + j;
        this.radial.copy(this.normal).multiplyScalar(Math.cos(angle)).addScaledVector(this.binormal, Math.sin(angle));
        core.setXYZ(n, center.x + this.radial.x * coreRadius, center.y + this.radial.y * coreRadius, center.z + this.radial.z * coreRadius);
        halo.setXYZ(n, center.x + this.radial.x * haloRadius, center.y + this.radial.y * haloRadius, center.z + this.radial.z * haloRadius);
      }
    }
    core.needsUpdate = true; halo.needsUpdate = true;
  }

  dispose() { this.core.dispose(); this.halo.dispose(); }
}
