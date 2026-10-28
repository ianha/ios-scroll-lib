# ios-scroll

iOS-style rubber banding, momentum and interruptible springs for the web. A dependency-free TypeScript library with a framework-independent DOM adapter and a pure physics core.

```ts
import { createIOSScroll } from "ios-scroll";

const scroll = createIOSScroll(document.querySelector<HTMLElement>("#feed")!);
```

## Try the example

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Drag or flick the field notes, pull either edge, change the spring or input coefficient, and watch the live position, velocity and stretch readings. Mouse, touch, pen, keyboard and wheel input work. The demo defaults to **Reduce motion** off and a **400ms rebound response**. Enable Reduce motion to disable kinetic animation.

```sh
npm run check     # Typecheck, physics tests, library build and example build
npm run preview   # Serve the production example after building
```

`npm run build` creates both the installable library in `dist/` and the static example in `dist-example/`. Deploy the contents of `dist-example/` to any static host; its assets use relative URLs. A browser integration check page is included at `/checks.html`.

## Install locally

This repository is prepared for publishing, but no npm publication is assumed. Build a tarball and install it into your app:

```sh
# In this repository:
npm install
npm pack

# In your app (use the actual path to the generated tarball):
npm install /path/to/ios-scroll-0.1.0.tgz
```

ES modules, CommonJS, TypeScript declarations and source maps are included. No CSS import is required. Requires a modern browser with Pointer Events, ResizeObserver, requestAnimationFrame and matchMedia event listeners; window resize is a fallback if ResizeObserver is unavailable. Library imports are safe during server rendering; create instances only after mounting in a browser.

## Two elements. One call.

Keep your existing content inside **one direct content wrapper**. Give the viewport a constrained size. Put padding on the content wrapper.

```html
<div
  id="feed"
  style="height: 400px; overflow: auto"
  aria-label="Recent activity"
  role="region"
>
  <div>
    <!-- Your list, cards, messages, or any other content -->
  </div>
</div>
```

```ts
import { createIOSScroll } from "ios-scroll";

const scroll = createIOSScroll(document.querySelector<HTMLElement>("#feed")!);

scroll.scrollTo(300); // instant, clamped to bounds
scroll.scrollTo(0, { behavior: "smooth" }); // interruptible spring
scroll.scrollBy(200, { behavior: "smooth" });
console.log(scroll.state); // position, velocity, max, overscroll, phase
scroll.stop(); // cancel and settle within bounds
scroll.refresh(); // measurements also update automatically

// On unmount / teardown:
scroll.destroy();
```

The library keeps real `scrollTop` / `scrollLeft` for in-bounds scrolling and translates only the content wrapper for overscroll. Native scroll events, focus navigation, `scrollIntoView` and external scroll writes remain available. Each viewport becomes keyboard-focusable if it wasn't already; arrows, Home, End, Page Up/Down and Space work. Destruction restores the inline properties and attributes the adapter changed and removes its listeners, observers, animation frames and timers. Destroy is idempotent; create a new instance to change options.

### React

No React adapter or extra package needed. Render the same wrapper in your component, and create the instance in an effect. This also works with React Strict Mode.

```tsx
import { useEffect, useRef } from "react";
import { createIOSScroll } from "ios-scroll";

export function Feed() {
  const viewport = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroll = createIOSScroll(viewport.current!);
    return () => scroll.destroy();
  }, []);

  return (
    <div
      ref={viewport}
      style={{ height: 400, overflow: "auto" }}
      role="region"
      aria-label="Recent activity"
    >
      <div>{/* Your content */}</div>
    </div>
  );
}
```

For Vue, initialize in `onMounted` and destroy in `onBeforeUnmount`. For Svelte, initialize in `onMount` and return `scroll.destroy` as cleanup. Children can update normally; the adapter doesn't move or reparent framework-managed DOM.

### Horizontal scrolling

```html
<div id="shelf" style="width: 100%; overflow: auto">
  <div style="display: flex; width: max-content; gap: 16px">
    <!-- Items -->
  </div>
</div>
```

```ts
const shelf = createIOSScroll(document.querySelector<HTMLElement>("#shelf")!, {
  axis: "x",
  spring: "snappy",
});
```

Horizontal wheels use `deltaX`, or Shift + wheel. Horizontal mode currently assumes left-to-right layout.

## Options

| Option             | Default                               | Meaning                                                                                     |
| ------------------ | ------------------------------------- | ------------------------------------------------------------------------------------------- |
| `axis`             | `'y'`                                 | `'x'` or `'y'`; one axis per viewport                                                       |
| `content`          | Single direct child                   | Explicit content element when the viewport also has other children                          |
| `spring`           | `'smooth'`                            | Spring for animated `scrollTo`: a preset or `{ response, dampingRatio }`                    |
| `reboundSpring`    | `{ response: 0.4, dampingRatio: 1 }` | Spring for returning from either edge; accepts the same presets or custom parameters        |
| `input`            | `'touch'`                             | Named input coefficient or a nonnegative number for pointer drags                           |
| `wheelInput`       | `'highResolutionWheel'`               | Named coefficient or number for wheel edge resistance                                       |
| `decelerationRate` | `0.998`                               | Velocity retained per millisecond on pointer release; `0.99` stops faster                   |
| `bounce`           | `true`                                | Enable rubber banding and the return spring at edges                                        |
| `wheel`            | `true`                                | Handle wheels and trackpads; `false` leaves wheel behavior native                           |
| `mouseDrag`        | `true`                                | Enable mouse dragging in addition to touch and pen                                          |
| `reducedMotion`    | `false`                              | Use `'auto'` to follow the OS; `true` disables inertia / animated scrollTo and settles releases immediately |
| `onUpdate`         | —                                     | Receive an immutable state snapshot whenever the adapter renders                            |

All distances use CSS pixels and all velocities use pixels per second. Spring response and physics time steps use **seconds**. `overscroll` is negative at the start, positive at the end. `phase` is `'idle'`, `'dragging'`, `'decelerating'` or `'springing'`.

### Tune the edge rebound

The edge return defaults to a faster, critically damped spring with a **0.4-second response**, independently of the `spring` used for animated `scrollTo`. It applies to pointer releases, wheel overscroll and momentum reaching either edge.

```ts
createIOSScroll(viewport, {
  reboundSpring: { response: 0.18, dampingRatio: 1 },
});

// Or use a named spring:
createIOSScroll(otherViewport, { reboundSpring: "interactive" });
```

A **lower response returns faster**; this is the spring's response parameter, not an exact animation duration. Keep `dampingRatio: 1` for a return without oscillation, or use a value such as `0.85` for a little bounce. Set `reboundSpring: 'smooth'` to restore the previous, slower edge return. The demo's **Rebound response** slider updates the copyable snippet. Reduced motion still takes precedence.

Named rubber-band inputs, from the article:

| Input                 | Coefficient |
| --------------------- | ----------: |
| `touch`               |        0.55 |
| `smallTrackpad`       |       0.715 |
| `largeTrackpad`       |        0.17 |
| `continuousMouse`     |         0.4 |
| `highResolutionWheel` |        0.17 |
| `lowResolutionWheel`  |         0.5 |
| `mac`                 |       0.075 |

Browsers don't reliably expose the device class or trackpad size, so the adapter uses explicit defaults rather than guessing. Choose `wheelInput` for your use case. Wheel events already contain OS momentum; the adapter does **not** launch an extra fling when a wheel stream ends. When a wheel gesture reaches an edge, it releases immediately using the same rebound spring and tracked content velocity as a touch release. Further outward momentum events from that stream do not hold, stretch, or restart the rebound. Reversing direction catches the spring immediately; a 100ms quiet gap starts a fresh gesture. Wheel line units map to 16px and page units to the viewport size. Ctrl + wheel remains available for browser zoom.

Reduced motion keeps direct manipulation but removes the kinetic tail and animated return after release. The native page outside a viewport remains unaffected.

## The math and its limits

Based on [Justin's iOS rubber-band and spring research](https://blog.justinbuilds.mov/ios/). That article distinguishes disassembled constants, framework measurements and inferred behavior; this library follows its equations without claiming to reproduce every part of UIKit.

For raw distance `x` beyond an edge, viewport dimension `d` and resistance coefficient `c`:

```text
rubberBand(x, d, c) = sign(x) · c · |x| · d / (d + c · |x|)
```

This rational curve approaches one viewport of stretch. At a touch coefficient of `0.55`, an initial pixel of raw drag produces about `0.55px` of content movement; resistance increases as the drag grows. An inverse mapping lets you catch an edge mid-return without jumping.

Springs solve the damped oscillator with mass normalized to one:

```text
x″ = −ω² · (x − target) − 2ζω · x′
ω = 2π / response
```

The core uses analytic solutions for underdamped, critically damped and overdamped springs, retaining both position and velocity when retargeting. The article's SwiftUI presets use response `0.5s` and damping ratios `1.0`, `0.85` and `0.70`. The default edge rebound uses a shorter, library-chosen response of `0.4s` for a quicker return. The named presets are spring presets measured by the author, **not a claim that UIScrollView uses those exact spring settings**.

The article does not specify a complete inertia implementation. This library adds an exponential decay model with the conventional iOS-style per-millisecond rates ([React Native documents `0.998` and `0.99` for iOS](https://reactnative.dev/docs/scrollview#decelerationrate)):

```text
k = −1000 · ln(rate)
v(t) = v₀ · exp(−kt)
x(t) = x₀ + v₀ · (1 − exp(−kt)) / k
```

Edge crossing is solved within each time step before switching to a spring. Rendering follows `requestAnimationFrame`, rather than assuming a 60Hz display. Pointer velocity is estimated with time-based smoothing; gesture thresholds, wheel-end detection and rest tolerances are implementation choices. This is an iOS-inspired interaction, not a bit-for-bit port or a physical-device-validated reproduction.

### Use the physics on its own

```ts
import { rubberBand, stepSpring, stepDecay } from "ios-scroll/physics";

rubberBand(100, 844); // ~51.64px

const state = { position: 100, velocity: -500 };
stepSpring(state, 0, 1 / 120, "smooth");
stepDecay(state, 1 / 120, 0.998);
```

Or build a custom renderer with the DOM-free `ScrollEngine`:

```ts
import { ScrollEngine } from "ios-scroll";

const engine = new ScrollEngine({ dimension: 500, max: 1500 });
engine.begin();
engine.dragBy(100, 0.016); // positive = toward the end; dt in seconds
engine.release();
engine.step(1 / 60); // returns the next state; call from your rendering loop
engine.animateTo(0); // retarget with current velocity
```

## Integration boundaries

- Enhance a bounded scroll **region**, rather than `body` or the document scroller. Leave viewport padding, CSS scroll snap and scroll anchoring to the content/layout; the adapter controls the latter two while mounted.
- Keep the content wrapper in normal flow. Position fixed UI outside it; sticky/fixed descendants may behave differently during transformed overscroll. For horizontal layouts, set a content width such as `max-content`.
- Place app-specific transforms on descendants of the content wrapper. The adapter composes overscroll with the wrapper's starting transform; changing that transform while mounted is not supported.
- Native editable controls and buttons keep their own pointer interactions. Use `data-ios-scroll-ignore` on custom widgets that should own dragging.
- Nested enhanced viewports and native scrollable children own their gestures. Automatic transfer to a parent at a child's boundary is not implemented. Pointer-based custom scrolling takes over text selection inside the region during a drag.
- ResizeObserver observes the viewport and content wrapper. Call `refresh()` after an overflow-only change that doesn't resize either observed box, or when revealing a previously hidden region if needed.
- The adapter writes scroll offsets for each animation frame, so virtualization should use native scroll events or `onUpdate`. Very large / virtual scroll ranges need their own integration. It does not add pull-to-refresh, paging, scroll snapping or two-axis / RTL physics.

## Development

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

Pure tests cover reference values, inverse resistance, spring solutions, interruption continuity, inertia, edge transitions, frame-rate invariance, bounds changes and invalid inputs. Open `/checks.html` on the dev or production example server for DOM integration checks, including lifecycle cleanup, native scrolling, keyboard, pointer, wheel, reduced motion and resizing.

MIT licensed. The article and Apple product names belong to their respective owners.
