import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement requestAnimationFrame consistently; provide a sync shim
// so focus management inside keyboard handlers runs deterministically in tests.
if (typeof globalThis.requestAnimationFrame !== "function") {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    return setTimeout(() => cb(performance.now()), 0) as unknown as number;
  }) as typeof requestAnimationFrame;
}
