import { useEffect, useRef } from "react";
import { createConstellationScene } from "./constellationScene";

export default function ConstellationCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    const scene = createConstellationScene(canvas, { reducedMotion });
    scene.start();
    scene.resize();

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onDown = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      scene.setDragging(true);
      stage.setPointerCapture(event.pointerId);
      stage.classList.add("cursor-grabbing");
      event.preventDefault();
    };
    const onMove = (event: PointerEvent) => {
      const rect = stage.getBoundingClientRect();
      scene.setPointer(event.clientX - rect.left, event.clientY - rect.top);
      if (!dragging) return;
      scene.drag(event.clientX - lastX, event.clientY - lastY);
      lastX = event.clientX;
      lastY = event.clientY;
    };
    const onUp = (event: PointerEvent) => {
      dragging = false;
      scene.setDragging(false);
      stage.classList.remove("cursor-grabbing");
      if (
        typeof stage.hasPointerCapture === "function" &&
        stage.hasPointerCapture(event.pointerId)
      ) {
        stage.releasePointerCapture(event.pointerId);
      }
    };

    stage.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerup", onUp);
    stage.addEventListener("pointercancel", onUp);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("resize", scene.resize);
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scene.resize);
    observer?.observe(stage);

    return () => {
      scene.stop();
      observer?.disconnect();
      stage.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerup", onUp);
      stage.removeEventListener("pointercancel", onUp);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("resize", scene.resize);
    };
  }, []);

  return (
    <div ref={stageRef} className="absolute inset-0 cursor-grab touch-none select-none" aria-hidden>
      <canvas ref={canvasRef} className="block h-full w-full [image-rendering:auto]" />
    </div>
  );
}
