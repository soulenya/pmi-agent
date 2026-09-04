/**
 * How a node looks.
 *
 * Everything lives in the node's `style` bag, which is free-form JSON on the
 * server. Every key is optional and every reader falls back to what the canvas
 * drew before these keys existed, so boards made earlier are untouched.
 */

import type { CanvasNode } from "@/types/canvas";

export const STICKY_COLORS = [
  "#fde68a",
  "#bfdbfe",
  "#bbf7d0",
  "#fecaca",
  "#e9d5ff",
  "#e5e7eb",
];

export const LINE_COLORS = [
  "#0f172a",
  "#64748b",
  "#dc2626",
  "#ea580c",
  "#16a34a",
  "#2563eb",
  "#9333ea",
];

export const SHAPE_FORMS = ["rounded", "rect", "ellipse", "diamond", "arrow"] as const;
export type ShapeForm = (typeof SHAPE_FORMS)[number];

/** Drawn in a 100×100 box and stretched, so one path serves every size. */
export const SHAPE_PATHS: Record<ShapeForm, string> = {
  rect: "M1 1 H99 V99 H1 Z",
  rounded:
    "M7 1 H93 A6 6 0 0 1 99 7 V93 A6 6 0 0 1 93 99 H7 A6 6 0 0 1 1 93 V7 A6 6 0 0 1 7 1 Z",
  ellipse: "M50 1 A49 49 0 1 1 49.9 1 Z",
  diamond: "M50 1 L99 50 L50 99 L1 50 Z",
  arrow: "M1 32 H62 V8 L99 50 L62 92 V68 H1 Z",
};

export const SHAPE_LABELS: Record<ShapeForm, string> = {
  rounded: "Rounded",
  rect: "Rectangle",
  ellipse: "Ellipse",
  diamond: "Diamond",
  arrow: "Arrow",
};

export const DEFAULT_SHAPE_COLOR = "#94a3b8";
export const DEFAULT_FONT_SIZE = 14;

export interface NodeStyle {
  /** The original single-colour key: a sticky's paper, a shape's accent. */
  color?: string;
  /** "none" leaves the shape hollow. Absent means a tint of `color`. */
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  dashed?: boolean;
  textColor?: string;
  fontSize?: number;
  bold?: boolean;
  align?: "left" | "center" | "right";
  /** 0–1. */
  opacity?: number;
  shape?: ShapeForm;
  /** A solid shape catches clicks; a hollow one lets them through. */
  solid?: boolean;
  /** False once the user has dragged a height deliberately. */
  autoHeight?: boolean;
  /** Ink carries its own samples in the same bag. */
  points?: [number, number, number][];
  size?: number;
}

export function styleOf(node: Pick<CanvasNode, "style">): NodeStyle {
  return (node.style ?? {}) as NodeStyle;
}

/** A change to a style bag. Null clears the key and lets the default return. */
export type StylePatch = { [K in keyof NodeStyle]?: NodeStyle[K] | null };

/** Drop keys set back to nothing, so the bag does not collect empties. */
export function cleanStyle(style: NodeStyle | StylePatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.entries(style).forEach(([k, v]) => {
    if (v !== undefined && v !== null) out[k] = v;
  });
  return out;
}

export interface ShapeLook {
  form: ShapeForm;
  fill: string;
  stroke: string;
  strokeWidth: number;
  dashed: boolean;
  solid: boolean;
}

export function shapeLook(style: NodeStyle): ShapeLook {
  const accent = style.color ?? DEFAULT_SHAPE_COLOR;
  return {
    form: style.shape ?? "rounded",
    fill: style.fill ?? `${accent}22`,
    stroke: style.stroke ?? accent,
    strokeWidth: style.strokeWidth ?? 2,
    dashed: style.dashed ?? false,
    solid: style.solid ?? false,
  };
}

/** The text run inside a note, a text box or a shape. */
export function textLook(style: NodeStyle, fallbackColor?: string) {
  return {
    color: style.textColor ?? fallbackColor,
    fontSize: style.fontSize ?? DEFAULT_FONT_SIZE,
    fontWeight: style.bold ? 600 : undefined,
    textAlign: style.align,
  } as const;
}

export function autoHeight(style: NodeStyle): boolean {
  return style.autoHeight !== false;
}

/** One value if every node agrees, otherwise undefined. */
export function shared<T>(values: (T | undefined)[]): T | undefined {
  if (values.length === 0) return undefined;
  const first = values[0];
  return values.every((v) => v === first) ? first : undefined;
}
