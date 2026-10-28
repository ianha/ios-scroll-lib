import {
  ScrollEngine,
  clamp,
  type EngineOptions,
  type ScrollState,
} from "./engine";
import { RUBBER_BAND_COEFFICIENTS, type InputType } from "./physics";
export { ScrollEngine } from "./engine";
export type { EngineOptions, ScrollPhase, ScrollState } from "./engine";
export * from "./physics";

export interface IOSScrollOptions
  extends Omit<EngineOptions, "dimension" | "max" | "coefficient"> {
  axis?: "x" | "y";
  /** Direct child to translate. Defaults to the viewport's single element child. */
  content?: HTMLElement;
  /** Drag coefficient, or a named device from the article. Default: touch. */
  input?: InputType | number;
  /** Browsers cannot reliably identify trackpad size. Choose explicitly. */
  wheelInput?: InputType | number;
  /** Handle mouse / trackpad wheel events, without adding a second inertial tail. */
  wheel?: boolean;
  mouseDrag?: boolean;
  /** Default: false. Use "auto" to follow the OS; true disables inertia and animated scrollTo. */
  reducedMotion?: boolean | "auto";
  onUpdate?: (state: ScrollState) => void;
}
export interface ScrollToOptions {
  behavior?: "instant" | "smooth";
}
export interface IOSScroll {
  readonly state: ScrollState;
  scrollTo(position: number, options?: ScrollToOptions): void;
  scrollBy(delta: number, options?: ScrollToOptions): void;
  /** Cancel movement at the nearest in-bounds position. */
  stop(): void;
  /** ResizeObserver calls this automatically. Useful after changing overflow content. */
  refresh(): void;
  /** Remove listeners, observers, timers and only the styles/attributes we changed. */
  destroy(): void;
}
const instances = new WeakMap<HTMLElement, IOSScroll>();
function coefficient(input: InputType | number): number {
  const result =
    typeof input === "number" ? input : RUBBER_BAND_COEFFICIENTS[input];
  if (!Number.isFinite(result) || result < 0)
    throw new RangeError("Unknown input or invalid coefficient.");
  return result;
}

/** Enhance an existing viewport. Import is safe in SSR; call after mounting. */
export function createIOSScroll(
  viewport: HTMLElement,
  options: IOSScrollOptions = {},
): IOSScroll {
  if (!viewport || viewport.nodeType !== 1)
    throw new TypeError("Pass a viewport HTMLElement to createIOSScroll.");
  if (instances.has(viewport))
    throw new Error(
      "This viewport already has an ios-scroll instance. Destroy it first.",
    );
  const win = viewport.ownerDocument.defaultView;
  if (!win) throw new Error("The viewport must belong to a browser document.");
  const content =
    options.content ??
    (viewport.children.length === 1
      ? (viewport.firstElementChild as HTMLElement)
      : null);
  if (!content || content.parentElement !== viewport || !content.style) {
    throw new Error(
      "Use one content wrapper directly inside the viewport, or pass { content }.",
    );
  }
  const horizontal = options.axis === "x";
  const scrollKey = horizontal ? "scrollLeft" : "scrollTop";
  const dragCoefficient = coefficient(options.input ?? "touch");
  const wheelCoefficient = coefficient(
    options.wheelInput ?? "highResolutionWheel",
  );
  const engine = new ScrollEngine({ ...options, coefficient: dragCoefficient });
  const media = win.matchMedia("(prefers-reduced-motion: reduce)");
  const reduced = () =>
    options.reducedMotion === true ||
    (options.reducedMotion === "auto" && media.matches);
  const controller = new win.AbortController();
  const signal = controller.signal;
  let destroyed = false;
  let frame = 0;
  let lastFrame = 0;
  let lastWheel = 0;
  let wheelTimer: ReturnType<typeof setTimeout> | undefined;
  // The edge already released by this wheel gesture. Ignore its outward OS tail.
  let wheelEdge = 0;
  let pointer:
    | { id: number; start: number; last: number; time: number; moved: boolean }
    | undefined;
  let suppressClick = false;
  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  const saved: Array<() => void> = [];
  function style(element: HTMLElement, key: string, value: string): void {
    const before = element.style.getPropertyValue(key);
    const priority = element.style.getPropertyPriority(key);
    element.style.setProperty(key, value);
    saved.push(() =>
      before
        ? element.style.setProperty(key, before, priority)
        : element.style.removeProperty(key),
    );
  }
  const originalTransform = content.style.transform;
  const baseTransform = win.getComputedStyle(content).transform;
  style(viewport, "overflow-x", horizontal ? "auto" : "hidden");
  style(viewport, "overflow-y", horizontal ? "hidden" : "auto");
  style(viewport, "overscroll-behavior", "none");
  style(
    viewport,
    "touch-action",
    horizontal ? "pan-y pinch-zoom" : "pan-x pinch-zoom",
  );
  style(viewport, "scroll-behavior", "auto");
  style(viewport, "scroll-snap-type", "none");
  style(viewport, "overflow-anchor", "none");
  style(content, "will-change", "transform");
  style(content, "transform", originalTransform);
  // A flow root keeps descendant margins inside the measured wrapper.
  if (win.getComputedStyle(content).display === "block")
    style(content, "display", "flow-root");
  const originalTabindex = viewport.getAttribute("tabindex");
  if (originalTabindex === null) {
    viewport.tabIndex = 0;
    saved.push(() => viewport.removeAttribute("tabindex"));
  }

  function render(): void {
    if (destroyed) return;
    const state = engine.state;
    viewport[scrollKey] = clamp(state.position, 0, state.max);
    const translate = horizontal
      ? `${-state.overscroll}px,0,0`
      : `0,${-state.overscroll}px,0`;
    content!.style.transform = state.overscroll
      ? `translate3d(${translate})${baseTransform && baseTransform !== "none" ? ` ${baseTransform}` : ""}`
      : originalTransform;
    options.onUpdate?.(state);
  }
  function cancelFrame(): void {
    win!.cancelAnimationFrame(frame);
    frame = 0;
  }
  function tick(now: number): void {
    frame = 0;
    if (destroyed) return;
    engine.step(Math.max(0, now - lastFrame) / 1000);
    lastFrame = now;
    render();
    if (
      engine.state.phase === "springing" ||
      engine.state.phase === "decelerating"
    )
      frame = win!.requestAnimationFrame(tick);
  }
  function animate(): void {
    if (
      !frame &&
      !destroyed &&
      (engine.state.phase === "springing" ||
        engine.state.phase === "decelerating")
    ) {
      lastFrame = win!.performance.now();
      frame = win!.requestAnimationFrame(tick);
    }
  }
  function refresh(): void {
    if (destroyed) return;
    const dimension = horizontal ? viewport.clientWidth : viewport.clientHeight;
    const size = horizontal
      ? Math.max(content!.offsetWidth, content!.scrollWidth)
      : Math.max(content!.offsetHeight, content!.scrollHeight);
    engine.setBounds(dimension, Math.max(0, size - dimension));
    render();
  }
  function clearWheel(): void {
    clearTimeout(wheelTimer);
    wheelTimer = undefined;
    wheelEdge = 0;
  }
  function finishWheel(): void {
    const alreadyReleased = wheelEdge !== 0;
    clearWheel();
    // Do not restart or zero the velocity of a rebound already in flight.
    if (alreadyReleased) return;
    engine.release(0);
    if (reduced()) engine.jumpTo(engine.state.position);
    render();
    animate();
  }
  function belongsToChild(event: Event): boolean {
    for (const node of event.composedPath()) {
      if (node === viewport) return false;
      if (node instanceof win!.HTMLElement) {
        if (instances.has(node)) return true;
        const css = win!.getComputedStyle(node);
        if (
          /(auto|scroll)/.test(horizontal ? css.overflowX : css.overflowY) &&
          (horizontal
            ? node.scrollWidth > node.clientWidth
            : node.scrollHeight > node.clientHeight)
        )
          return true;
      }
    }
    return false;
  }
  function endPointer(cancel: boolean): void {
    if (!pointer) return;
    const { id, moved, time } = pointer;
    pointer = undefined;
    if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
    if (moved) {
      suppressClick = true;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        suppressClick = false;
      }, 0);
    }
    engine.release(
      cancel || reduced() || win!.performance.now() - time > 80
        ? 0
        : engine.state.velocity,
    );
    if (reduced()) engine.jumpTo(engine.state.position);
    render();
    animate();
  }
  viewport.addEventListener(
    "pointerdown",
    (event) => {
      if (pointer) {
        endPointer(true);
        return;
      }
      if (
        !event.isPrimary ||
        event.button !== 0 ||
        (event.pointerType === "mouse" && options.mouseDrag === false) ||
        belongsToChild(event)
      )
        return;
      const target = event.target as Element;
      if (
        target.closest(
          'input, textarea, select, button, [contenteditable]:not([contenteditable="false"]), [data-ios-scroll-ignore]',
        )
      )
        return;
      clearWheel();
      cancelFrame();
      engine.begin(dragCoefficient);
      const point = horizontal ? event.clientX : event.clientY;
      pointer = {
        id: event.pointerId,
        start: point,
        last: point,
        time: win!.performance.now(),
        moved: false,
      };
    },
    { signal },
  );
  win.addEventListener(
    "pointermove",
    (event) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      const point = horizontal ? event.clientX : event.clientY;
      if (!pointer.moved && Math.abs(point - pointer.start) < 4) return;
      if (!pointer.moved) {
        pointer.moved = true;
        viewport.setPointerCapture(event.pointerId);
      }
      if (event.cancelable) event.preventDefault();
      const now = win!.performance.now();
      engine.dragBy(
        pointer.last - point,
        Math.max(1, now - pointer.time) / 1000,
      );
      pointer.last = point;
      pointer.time = now;
      render();
    },
    { signal, passive: false },
  );
  win.addEventListener(
    "pointerup",
    (event) => {
      if (event.pointerId === pointer?.id) endPointer(false);
    },
    { signal },
  );
  win.addEventListener(
    "pointercancel",
    (event) => {
      if (event.pointerId === pointer?.id) endPointer(true);
    },
    { signal },
  );
  viewport.addEventListener("lostpointercapture", () => endPointer(true), {
    signal,
  });
  win.addEventListener("blur", () => endPointer(true), { signal });
  viewport.addEventListener(
    "dragstart",
    (event) => {
      if (pointer) event.preventDefault();
    },
    { signal },
  );
  viewport.addEventListener(
    "selectstart",
    (event) => {
      if (pointer) event.preventDefault();
    },
    { signal },
  );
  viewport.addEventListener(
    "click",
    (event) => {
      if (suppressClick) {
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressClick = false;
      }
    },
    { signal, capture: true },
  );

  viewport.addEventListener(
    "wheel",
    (event) => {
      if (
        options.wheel === false ||
        event.ctrlKey ||
        event.defaultPrevented ||
        pointer ||
        belongsToChild(event)
      )
        return;
      const delta = horizontal
        ? event.deltaX || (event.shiftKey ? event.deltaY : 0)
        : event.deltaY;
      if (!delta || !event.cancelable) return;
      event.preventDefault();
      const now = win!.performance.now();
      if (wheelEdge === Math.sign(delta)) {
        // Trackpads keep sending decaying deltas after impact. They must not
        // keep pulling the edge, cancel its spring, or launch another rebound.
        lastWheel = now;
        clearTimeout(wheelTimer);
        wheelTimer = setTimeout(finishWheel, 100);
        return;
      }
      // An inward gesture catches the current spring, just like a fresh touch.
      if (wheelEdge !== 0) clearWheel();
      cancelFrame();
      if (wheelTimer === undefined) engine.begin(wheelCoefficient);
      const units =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? horizontal
              ? viewport.clientWidth
              : viewport.clientHeight
            : 1;
      engine.dragBy(
        delta * units,
        Math.max(1, Math.min(50, now - lastWheel)) / 1000,
      );
      lastWheel = now;
      if (reduced()) engine.jumpTo(engine.state.position);
      else if (engine.state.overscroll !== 0) {
        wheelEdge = Math.sign(engine.state.overscroll);
        // Use the same displayed position, tracked velocity and rebound spring
        // as a touch release. No wheel-stream timeout before returning home.
        engine.release();
        animate();
      }
      render();
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(finishWheel, 100);
    },
    { signal, passive: false },
  );
  // Keep native keyboard scrolling, focus, scrollIntoView and external scrollTop writes in sync.
  viewport.addEventListener(
    "scroll",
    () => {
      if (destroyed) return;
      const expected = clamp(engine.state.position, 0, engine.state.max);
      if (Math.abs(viewport[scrollKey] - expected) > 1) {
        cancelFrame();
        clearWheel();
        engine.jumpTo(viewport[scrollKey]);
        render();
      }
    },
    { signal },
  );
  viewport.addEventListener(
    "keydown",
    (event) => {
      if (
        event.target !== viewport ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      const page =
        (horizontal ? viewport.clientWidth : viewport.clientHeight) * 0.9;
      const deltas: Record<string, number> = {
        [horizontal ? "ArrowLeft" : "ArrowUp"]: -40,
        [horizontal ? "ArrowRight" : "ArrowDown"]: 40,
        PageUp: -page,
        PageDown: page,
        " ": event.shiftKey ? -page : page,
      };
      const delta = deltas[event.key];
      if (delta === undefined && event.key !== "Home" && event.key !== "End")
        return;
      event.preventDefault();
      api.scrollTo(
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? engine.state.max
            : engine.state.position + delta!,
      );
    },
    { signal },
  );
  const resizeObserver =
    typeof win.ResizeObserver === "function"
      ? new win.ResizeObserver(refresh)
      : undefined;
  resizeObserver?.observe(viewport);
  resizeObserver?.observe(content);
  win.addEventListener("resize", refresh, { signal });
  media.addEventListener(
    "change",
    () => {
      if (reduced()) {
        cancelFrame();
        clearWheel();
        engine.jumpTo(engine.state.position);
        render();
      }
    },
    { signal },
  );

  const api: IOSScroll = {
    get state() {
      return engine.state;
    },
    scrollTo(position, config = {}) {
      if (destroyed) return;
      clearWheel();
      if (config.behavior === "smooth" && !reduced()) {
        engine.animateTo(position);
        animate();
      } else {
        cancelFrame();
        engine.jumpTo(position);
        render();
      }
    },
    scrollBy(delta, config) {
      api.scrollTo(engine.state.position + delta, config);
    },
    stop() {
      if (!destroyed) {
        cancelFrame();
        clearWheel();
        engine.jumpTo(engine.state.position);
        render();
      }
    },
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelFrame();
      clearWheel();
      clearTimeout(clickTimer);
      if (pointer && viewport.hasPointerCapture(pointer.id))
        viewport.releasePointerCapture(pointer.id);
      pointer = undefined;
      controller.abort();
      resizeObserver?.disconnect();
      // Reset transform first, then restore the nearest valid native scroll offset.
      for (const restore of saved.reverse()) restore();
      viewport[scrollKey] = clamp(engine.state.position, 0, engine.state.max);
      instances.delete(viewport);
    },
  };
  instances.set(viewport, api);
  const initialPosition = viewport[scrollKey];
  refresh();
  engine.jumpTo(initialPosition);
  render();
  return api;
}
