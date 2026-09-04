/** Freehand ink: raw pointer samples in, an outline path out. */

import getStroke from "perfect-freehand";

export type InkPoint = [number, number, number];

export function strokePath(points: InkPoint[], size: number): string {
  const outline = getStroke(points, {
    size,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.5,
  });
  if (!outline.length) return "";
  const d = outline.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...outline[0], "Q"] as (string | number)[],
  );
  return `${d.join(" ")} Z`;
}

export function inkBounds(points: InkPoint[]) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}
