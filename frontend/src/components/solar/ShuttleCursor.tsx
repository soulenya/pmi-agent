/**
 * ShuttleCursor — replaces the mouse cursor with a NASA-shuttle-style ship
 * while inside the space views (system overview, planet views, Gerry).
 *
 * The shuttle orients nose-first along the direction of travel (smoothed,
 * shortest-path rotation) and its engines leave a small, quickly-fading
 * trail. All motion runs through refs + requestAnimationFrame with direct
 * style writes — no React re-renders per mousemove. Trail dots are plain
 * DOM nodes that remove themselves when their CSS animation ends.
 *
 * Mounted as the last child of the canvas root; the parent element receives
 * the `space-cursor-zone` class, which hides the native cursor.
 */
import { useEffect, useRef } from "react";

export function ShuttleCursor() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const shipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const ship = shipRef.current;
    const parent = wrap?.parentElement;
    if (!wrap || !ship || !parent) return;

    parent.classList.add("space-cursor-zone");

    // Honor reduced-motion for the gratuitous engine trail only; the ship itself
    // always renders so the custom cursor is present on every platform.
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const s = {
      x: -100,
      y: -100,
      tx: -100,
      ty: -100,
      angle: -90, // degrees; SVG nose points up (=-90 in screen coords)
      visible: false,
      seeded: false,
      lastTrail: 0,
    };

    const onMove = (e: MouseEvent) => {
      const r = parent.getBoundingClientRect();
      s.tx = e.clientX - r.left;
      s.ty = e.clientY - r.top;
      if (!s.seeded) {
        // First movement: appear at the pointer instead of flying in.
        s.x = s.tx;
        s.y = s.ty;
        s.seeded = true;
      }
      s.visible = true;
    };
    const onLeave = () => {
      s.visible = false;
    };

    const spawnTrail = () => {
      // Engine position: just behind the ship, opposite the heading.
      const rad = ((s.angle - 90) * Math.PI) / 180;
      const dot = document.createElement("span");
      dot.className = "shuttle-trail-dot";
      dot.style.left = `${s.x - Math.cos(rad) * 15}px`;
      dot.style.top = `${s.y - Math.sin(rad) * 15}px`;
      dot.addEventListener("animationend", () => dot.remove());
      wrap.appendChild(dot);
    };

    let raf = 0;
    const tick = (now: number) => {
      const dx = s.tx - s.x;
      const dy = s.ty - s.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 0.5) {
        // Rotate nose toward the direction of travel (shortest path).
        const target = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
        const diff = ((target - s.angle + 540) % 360) - 180;
        s.angle += diff * 0.22;

        s.x += dx * 0.35;
        s.y += dy * 0.35;

        if (dist > 2 && now - s.lastTrail > 28) {
          s.lastTrail = now;
          if (!reduceMotion) spawnTrail();
        }
      } else {
        s.x = s.tx;
        s.y = s.ty;
      }

      ship.style.opacity = s.visible && s.seeded ? "1" : "0";
      ship.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%) rotate(${s.angle}deg)`;

      raf = requestAnimationFrame(tick);
    };

    parent.addEventListener("mousemove", onMove);
    parent.addEventListener("mouseleave", onLeave);
    raf = requestAnimationFrame(tick);

    return () => {
      parent.removeEventListener("mousemove", onMove);
      parent.removeEventListener("mouseleave", onLeave);
      parent.classList.remove("space-cursor-zone");
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={wrapRef} className="pointer-events-none absolute inset-0 z-50 overflow-hidden" aria-hidden>
      <div
        ref={shipRef}
        className="absolute left-0 top-0 opacity-0 drop-shadow-[0_0_5px_rgba(148,163,184,0.7)]"
        style={{ willChange: "transform" }}
      >
        {/* NASA-shuttle silhouette, drawn nose-up; s.angle already includes the +90° nose offset. */}
        <svg width="26" height="32" viewBox="0 0 26 32">
          {/* Delta wings */}
          <path d="M13 9 L24 26 L20.5 27.5 L13 23.5 L5.5 27.5 L2 26 Z" fill="#cbd5e1" />
          {/* Fuselage */}
          <path d="M13 0.5 C15.4 3.2 16.2 6.4 16.2 10 L16.2 26 L9.8 26 L9.8 10 C9.8 6.4 10.6 3.2 13 0.5 Z" fill="#f8fafc" />
          {/* Black nose cap */}
          <path d="M13 0.5 C14.4 2.1 15.3 3.9 15.8 6 L10.2 6 C10.7 3.9 11.6 2.1 13 0.5 Z" fill="#334155" />
          {/* Tail fin */}
          <rect x="12.1" y="20" width="1.8" height="8" rx="0.6" fill="#94a3b8" />
          {/* Engines */}
          <circle cx="10.8" cy="27.2" r="1.4" fill="#475569" />
          <circle cx="15.2" cy="27.2" r="1.4" fill="#475569" />
          {/* Engine glow */}
          <ellipse cx="13" cy="29.5" rx="2.6" ry="1.4" fill="rgba(96,165,250,0.55)" />
        </svg>
      </div>
    </div>
  );
}
