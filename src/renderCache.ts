/** Bound native raster work independently of CSS layout and pointer coordinates. */
export function renderScale(native: boolean, width: number, height: number, deviceScale: number): number {
  const scale = Number.isFinite(deviceScale) && deviceScale > 0 ? deviceScale : 1;
  return native ? Math.min(scale, 2, Math.sqrt(1_000_000 / Math.max(1, width * height))) : scale;
}

export interface LayerBounds { x: number; y: number; width: number; height: number }

/** A single bounded raster, invalidated by content, size, position or display scale changes. */
export class CanvasLayer {
  private image: HTMLCanvasElement | null = null;
  private signature = "";
  private content: unknown;

  draw(target: CanvasRenderingContext2D, bounds: LayerBounds, scale: number, content: unknown,
    paint: (context: CanvasRenderingContext2D) => void): void {
    const { x, y, width, height } = bounds;
    const signature = `${x}:${y}:${width}:${height}:${scale}`;
    this.image ??= document.createElement("canvas");
    if (signature !== this.signature || content !== this.content) {
      const pixelsWide = Math.ceil(width * scale), pixelsHigh = Math.ceil(height * scale);
      if (this.image.width !== pixelsWide) this.image.width = pixelsWide;
      if (this.image.height !== pixelsHigh) this.image.height = pixelsHigh;
      const context = this.image.getContext("2d")!;
      context.save();
      context.setTransform(scale, 0, 0, scale, -x * scale, -y * scale);
      context.clearRect(x, y, pixelsWide / scale, pixelsHigh / scale);
      try { paint(context); } finally { context.restore(); }
      this.signature = signature;
      this.content = content;
    }
    target.drawImage(this.image, x, y, this.image.width / scale, this.image.height / scale);
  }
}

/** Bounded sprite storage: moving a sprite reuses its raster, rather than allocating another. */
export class SpriteCache {
  private layers = new Map<string, CanvasLayer>();
  constructor(private capacity = 48) {}

  draw(target: CanvasRenderingContext2D, x: number, y: number, bounds: LayerBounds, scale: number,
    key: string, paint: (context: CanvasRenderingContext2D) => void): void {
    let layer = this.layers.get(key);
    if (!layer) {
      if (this.layers.size >= this.capacity) this.layers.delete(this.layers.keys().next().value!);
      layer = new CanvasLayer();
      this.layers.set(key, layer);
    }
    target.save();
    target.translate(x, y);
    layer.draw(target, bounds, scale, key, paint);
    target.restore();
  }
}
