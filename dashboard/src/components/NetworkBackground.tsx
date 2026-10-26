import { useEffect, useRef } from "react";

type Node = { x: number; y: number; vx: number; vy: number; r: number; red: boolean; phase: number };

const LINK_DISTANCE = 150;
const POINTER_DISTANCE = 190;

/**
 * Full-screen animated constellation: slowly drifting nodes joined by
 * hairlines when they come close, with a few red nodes that pulse. The
 * pointer pulls faint red links toward itself. Drawn on one fixed canvas
 * behind every page, decorative only (aria-hidden), paused while the tab is
 * hidden, and frozen into a single static frame for prefers-reduced-motion.
 */
export function NetworkBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let frame = 0;
    let nodes: Node[] = [];
    const pointer = { x: -9999, y: -9999 };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min(120, Math.max(36, (width * height) / 13000)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: Math.random() * 1.3 + 0.5,
        red: Math.random() < 0.14,
        phase: Math.random() * Math.PI * 2,
      }));
    };

    const draw = (time: number) => {
      ctx.clearRect(0, 0, width, height);

      for (const n of nodes) {
        if (!reduceMotion) {
          n.x += n.vx;
          n.y += n.vy;
          if (n.x < -20) n.x = width + 20;
          if (n.x > width + 20) n.x = -20;
          if (n.y < -20) n.y = height + 20;
          if (n.y > height + 20) n.y = -20;
        }
      }

      ctx.lineWidth = 0.6;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist > LINK_DISTANCE) continue;
          const alpha = 1 - dist / LINK_DISTANCE;
          ctx.strokeStyle = a.red || b.red ? `rgba(214, 43, 34, ${alpha * 0.5})` : `rgba(255, 255, 255, ${alpha * 0.19})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        const pd = Math.hypot(a.x - pointer.x, a.y - pointer.y);
        if (pd < POINTER_DISTANCE) {
          ctx.strokeStyle = `rgba(255, 83, 72, ${(1 - pd / POINTER_DISTANCE) * 0.35})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(pointer.x, pointer.y);
          ctx.stroke();
        }
      }

      for (const n of nodes) {
        if (n.red) {
          const pulse = reduceMotion ? 0 : Math.sin(time / 700 + n.phase) * 0.7;
          ctx.fillStyle = "rgba(255, 70, 58, 0.95)";
          ctx.shadowColor = "rgba(214, 43, 34, 0.9)";
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + 0.8 + pulse, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      if (!reduceMotion) frame = requestAnimationFrame(draw);
    };

    const onPointerMove = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    };
    const onPointerLeave = () => {
      pointer.x = -9999;
      pointer.y = -9999;
    };
    const onVisibility = () => {
      cancelAnimationFrame(frame);
      if (!document.hidden) frame = requestAnimationFrame(draw);
    };
    const onResize = () => {
      resize();
      if (reduceMotion) draw(0);
    };

    resize();
    frame = requestAnimationFrame(draw);
    window.addEventListener("resize", onResize);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerleave", onPointerLeave);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div className="network-bg" aria-hidden="true">
      <canvas ref={canvasRef} className="network-canvas" />
      <div className="network-vignette" />
    </div>
  );
}
