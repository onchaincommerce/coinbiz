"use client";

import { useEffect, useRef } from "react";

type Particle = {
  alpha: number;
  color: string;
  originX: number;
  originY: number;
  radius: number;
  x: number;
  y: number;
};

const PARTICLE_COLORS = ["#3778ff", "#6497ff", "#714dff", "#b6ceff"];

export function DisintegrationField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const field = fieldRef.current;

    if (!canvas || !field) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    const host = field;
    const surface = canvas;
    const drawingContext = context;

    const pointer = { active: false, x: -1000, y: -1000 };
    const particles: Particle[] = [];
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frameId = 0;
    let height = 0;
    let width = 0;

    function seedParticles() {
      particles.length = 0;
      const count = Math.min(1050, Math.max(360, Math.floor((width * height) / 1150)));

      for (let index = 0; index < count; index += 1) {
        const bias = Math.pow(Math.random(), 0.58);
        const originX = width * (0.4 + bias * 0.62);
        const originY = height * (0.06 + Math.random() * 0.9);

        particles.push({
          alpha: 0.18 + Math.random() * 0.7,
          color: PARTICLE_COLORS[index % PARTICLE_COLORS.length],
          originX,
          originY,
          radius: 0.45 + Math.random() * 1.45,
          x: originX,
          y: originY,
        });
      }
    }

    function resize() {
      const rect = host.getBoundingClientRect();
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      surface.width = Math.round(width * scale);
      surface.height = Math.round(height * scale);
      surface.style.width = `${width}px`;
      surface.style.height = `${height}px`;
      drawingContext.setTransform(scale, 0, 0, scale, 0, 0);
      seedParticles();
    }

    function handlePointerMove(event: PointerEvent) {
      const rect = host.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      pointer.active =
        pointer.x >= 0 &&
        pointer.x <= rect.width &&
        pointer.y >= 0 &&
        pointer.y <= rect.height;

      host.style.setProperty("--cursor-x", `${pointer.x}px`);
      host.style.setProperty("--cursor-y", `${pointer.y}px`);
      host.dataset.pointer = pointer.active ? "active" : "idle";
      host.dataset.zone = pointer.x < rect.width * 0.44 ? "void" : "art";
    }

    function handlePointerLeave() {
      pointer.active = false;
      host.dataset.pointer = "idle";
      host.dataset.zone = "idle";
    }

    function render(time: number) {
      drawingContext.clearRect(0, 0, width, height);

      for (let index = 0; index < particles.length; index += 1) {
        const particle = particles[index];
        const driftX = Math.sin(time * 0.00035 + index) * 2.2;
        const driftY = Math.cos(time * 0.00028 + index * 0.7) * 1.8;
        let targetX = particle.originX + driftX;
        let targetY = particle.originY + driftY;

        if (pointer.active && !reduceMotion) {
          const dx = targetX - pointer.x;
          const dy = targetY - pointer.y;
          const distance = Math.max(1, Math.hypot(dx, dy));
          const reach = host.dataset.zone === "art" ? 104 : 128;

          if (distance < reach) {
            const force = Math.pow((reach - distance) / reach, 1.8) * 62;
            targetX += (dx / distance) * force;
            targetY += (dy / distance) * force;
          }
        }

        particle.x += (targetX - particle.x) * 0.075;
        particle.y += (targetY - particle.y) * 0.075;

        drawingContext.globalAlpha = particle.alpha;
        drawingContext.fillStyle = particle.color;
        drawingContext.beginPath();
        drawingContext.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        drawingContext.fill();
      }

      drawingContext.globalAlpha = 1;

      if (!reduceMotion) {
        frameId = window.requestAnimationFrame(render);
      }
    }

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", handlePointerLeave);
    resize();
    render(0);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("pointermove", handlePointerMove);
      document.documentElement.removeEventListener("mouseleave", handlePointerLeave);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="disintegration-field"
      data-pointer="idle"
      data-zone="idle"
      ref={fieldRef}
    >
      <div className="disintegration-image" />
      <canvas className="disintegration-canvas" ref={canvasRef} />
      <div className="disintegration-glow" />
    </div>
  );
}
