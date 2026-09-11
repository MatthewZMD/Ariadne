/** Local measurements only: no telemetry and no changes to simulation rules. */
export class AdaptiveQuality {
  quality = 1;
  target = 1;
  fps = 60;
  frameMs = 16.7;
  workMs = 0;
  private samples: number[] = [];
  private work: number[] = [];
  private elapsed = 0;
  private warmup = 3000;
  private healthyMs = 0;

  constructor(hints: { cores?: number; memoryGB?: number; saveData?: boolean } = {}) {
    // Hints only choose a starting point. Actual frame delivery decides thereafter.
    if ((hints.cores && hints.cores <= 4) || (hints.memoryGB && hints.memoryGB <= 4) || hints.saveData) this.quality = this.target = .75;
  }

  resetWindow() { this.samples = []; this.work = []; this.elapsed = 0; this.healthyMs = 0; this.warmup = 1000; }

  sample(frameMs: number, workMs: number) {
    if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 1000) { this.resetWindow(); return; }
    const dt = Math.min(frameMs, 100);
    this.quality += Math.sign(this.target - this.quality) * Math.min(Math.abs(this.target - this.quality), dt / 12000);
    if (this.warmup > 0) { this.warmup -= frameMs; return; }
    this.samples.push(frameMs); this.work.push(Math.max(0, workMs)); this.elapsed += frameMs;
    if (this.elapsed < 2000) return;
    const sorted = [...this.samples].sort((a, b) => a - b);
    this.frameMs = sorted[Math.floor(sorted.length * .8)]!;
    this.fps = 1000 / (this.samples.reduce((a, b) => a + b, 0) / this.samples.length);
    this.workMs = this.work.reduce((a, b) => a + b, 0) / this.work.length;
    if (this.frameMs > 23 || this.workMs > 18) {
      this.target = Math.max(0, this.target - .15); this.healthyMs = 0;
    } else if (this.frameMs < 18.5 && this.workMs < 12) {
      this.healthyMs += this.elapsed;
      if (this.healthyMs >= 12000) { this.target = Math.min(1, this.target + .05); this.healthyMs = 0; }
    } else this.healthyMs = 0;
    this.samples = []; this.work = []; this.elapsed = 0;
  }
}

/** Keep a bounded pixel budget even on a large, high-density display. */
export function renderPixelRatio(dpr: number, width: number, height: number, quality: number) {
  const base = Math.min(1.5, dpr || 1, Math.sqrt(2_500_000 / Math.max(1, width * height)));
  return base * (.55 + .45 * quality);
}
