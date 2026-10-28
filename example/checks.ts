import { createIOSScroll, type IOSScroll } from "../src/index";
const results = document.querySelector<HTMLOListElement>("#results")!;
const fixtures = document.querySelector<HTMLElement>("#fixtures")!;
const jobs: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, fn: () => void | Promise<void>) =>
  jobs.push([name, fn]);
function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}
const near = (a: number, b: number, epsilon = 1) =>
  assert(Math.abs(a - b) <= epsilon, `${a} != ${b}`);
const wait = (ms = 50) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
function fixture() {
  const viewport = document.createElement("div");
  viewport.style.cssText = "width:300px;height:200px;overflow:auto;";
  const content = document.createElement("div");
  content.style.cssText = "height:1000px;background:#eee;";
  viewport.append(content);
  fixtures.append(viewport);
  let scroll: IOSScroll | undefined;
  return {
    viewport,
    content,
    mount(options: Parameters<typeof createIOSScroll>[1] = {}) {
      scroll = createIOSScroll(viewport, { reducedMotion: false, ...options });
      return scroll;
    },
    cleanup() {
      scroll?.destroy();
      viewport.remove();
    },
  };
}

test("initial position, native offsets, API scrolling and bounds", () => {
  const f = fixture();
  f.viewport.scrollTop = 40;
  const scroll = f.mount();
  near(scroll.state.position, 40);
  scroll.scrollTo(300);
  near(f.viewport.scrollTop, 300);
  scroll.scrollBy(100);
  near(scroll.state.position, 400);
  scroll.scrollTo(5000);
  near(f.viewport.scrollTop, 800);
  scroll.scrollTo(-100);
  near(scroll.state.position, 0);
  assert(f.viewport.tabIndex === 0);
  f.cleanup();
});
test("external scrollTop writes synchronize with the engine", async () => {
  const f = fixture(),
    scroll = f.mount();
  f.viewport.scrollTop = 123;
  await wait();
  near(scroll.state.position, 123);
  f.cleanup();
});
test("keyboard navigation, bounds and ignored editable descendants", () => {
  const f = fixture(),
    scroll = f.mount();
  f.viewport.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "End",
      bubbles: true,
      cancelable: true,
    }),
  );
  near(scroll.state.position, 800);
  f.viewport.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Home",
      bubbles: true,
      cancelable: true,
    }),
  );
  near(scroll.state.position, 0);
  const input = document.createElement("input");
  f.content.append(input);
  input.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "End",
      bubbles: true,
      cancelable: true,
    }),
  );
  near(scroll.state.position, 0);
  f.cleanup();
});
test("wheel normalization and no extra momentum after a wheel stream", async () => {
  const f = fixture(),
    scroll = f.mount();
  f.viewport.dispatchEvent(
    new WheelEvent("wheel", { deltaY: 3, deltaMode: 1, cancelable: true }),
  );
  near(scroll.state.position, 48);
  f.viewport.dispatchEvent(
    new WheelEvent("wheel", { deltaY: 1, deltaMode: 2, cancelable: true }),
  );
  near(scroll.state.position, 248);
  await wait(160);
  assert(scroll.state.phase === "idle");
  near(scroll.state.position, 248);
  const zoom = new WheelEvent("wheel", {
    deltaY: 100,
    ctrlKey: true,
    cancelable: true,
  });
  f.viewport.dispatchEvent(zoom);
  assert(!zoom.defaultPrevented);
  f.cleanup();
});
test("wheel edge stretch returns to rest", async () => {
  const f = fixture(),
    scroll = f.mount();
  f.viewport.dispatchEvent(
    new WheelEvent("wheel", { deltaY: -200, cancelable: true }),
  );
  assert(scroll.state.overscroll < 0);
  assert(f.content.style.transform.includes("translate3d"));
  await wait(1300);
  near(scroll.state.position, 0, 0.1);
  assert(scroll.state.phase === "idle");
  f.cleanup();
});
test("reduced motion makes programmatic animation immediate", () => {
  const f = fixture(),
    scroll = f.mount({ reducedMotion: true });
  scroll.scrollTo(500, { behavior: "smooth" });
  near(scroll.state.position, 500);
  assert(scroll.state.phase === "idle");
  f.viewport.dispatchEvent(
    new WheelEvent("wheel", { deltaY: -1000, cancelable: true }),
  );
  near(scroll.state.position, 0);
  assert(scroll.state.phase === "idle");
  f.cleanup();
});
test("horizontal axis supports deltaX and Shift + wheel", () => {
  const f = fixture();
  f.content.style.width = "1000px";
  f.content.style.height = "100px";
  const scroll = f.mount({ axis: "x" });
  f.viewport.dispatchEvent(
    new WheelEvent("wheel", { deltaX: 100, cancelable: true }),
  );
  near(scroll.state.position, 100);
  near(f.viewport.scrollLeft, 100);
  f.viewport.dispatchEvent(
    new WheelEvent("wheel", { deltaY: 50, shiftKey: true, cancelable: true }),
  );
  near(f.viewport.scrollLeft, 150);
  f.cleanup();
});
test("ResizeObserver follows content growth and shrinkage", async () => {
  const f = fixture(),
    scroll = f.mount();
  near(scroll.state.max, 800);
  f.content.style.height = "1400px";
  await wait(100);
  near(scroll.state.max, 1200);
  scroll.scrollTo(1100);
  f.content.style.height = "400px";
  await wait(100);
  near(scroll.state.max, 200);
  near(scroll.state.position, 200);
  f.cleanup();
});
test("nested viewports own their wheel gesture", () => {
  const f = fixture(),
    outer = f.mount();
  const nested = document.createElement("div");
  nested.style.cssText = "height:100px;overflow:auto";
  const inner = document.createElement("div");
  inner.style.height = "400px";
  nested.append(inner);
  f.content.append(nested);
  const child = createIOSScroll(nested);
  nested.dispatchEvent(
    new WheelEvent("wheel", { deltaY: 50, bubbles: true, cancelable: true }),
  );
  near(child.state.position, 50);
  near(outer.state.position, 0);
  child.destroy();
  f.cleanup();
});
test("destroy restores styles / attributes and removes all event handlers", async () => {
  const f = fixture();
  f.viewport.style.setProperty("touch-action", "manipulation", "important");
  f.content.style.transform = "scale(1)";
  const beforeViewport = f.viewport.style.cssText,
    beforeContent = f.content.style.cssText;
  let updates = 0;
  const scroll = f.mount({ onUpdate: () => updates++ });
  scroll.scrollTo(300, { behavior: "smooth" });
  scroll.destroy();
  scroll.destroy();
  assert(
    f.viewport.style.cssText === beforeViewport,
    `Viewport styles changed: ${f.viewport.style.cssText}`,
  );
  assert(f.content.style.cssText === beforeContent, "Content styles changed");
  assert(!f.viewport.hasAttribute("tabindex"));
  const count = updates;
  f.viewport.dispatchEvent(
    new WheelEvent("wheel", { deltaY: 80, cancelable: true }),
  );
  f.viewport.dispatchEvent(
    new KeyboardEvent("keydown", { key: "End", cancelable: true }),
  );
  await wait();
  assert(updates === count, "Handler / frame leaked after destroy");
  f.cleanup();
});
test("existing tabindex survives and Strict Mode-style remount is supported", () => {
  const f = fixture();
  f.viewport.tabIndex = 3;
  const one = f.mount();
  one.destroy();
  assert(f.viewport.tabIndex === 3);
  const two = f.mount();
  two.scrollTo(100);
  near(two.state.position, 100);
  f.cleanup();
});
test("duplicate instances and invalid markup fail before changing DOM", () => {
  const f = fixture();
  const scroll = f.mount();
  let threw = false;
  try {
    createIOSScroll(f.viewport);
  } catch {
    threw = true;
  }
  assert(threw);
  scroll.destroy();
  f.viewport.append(document.createElement("div"));
  threw = false;
  try {
    createIOSScroll(f.viewport);
  } catch {
    threw = true;
  }
  assert(threw);
  f.cleanup();
});
test("buttons and ignored widgets retain pointer ownership", () => {
  const f = fixture(),
    scroll = f.mount();
  for (const tag of ["button", "input", "textarea"]) {
    const child = document.createElement(tag);
    f.content.append(child);
    child.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 1,
        isPrimary: true,
        button: 0,
        bubbles: true,
      }),
    );
    assert(scroll.state.phase === "idle");
  }
  f.cleanup();
});

test("mouse gestures suppress text selection until the pointer is released", () => {
  const f = fixture();
  f.mount();
  f.viewport.dispatchEvent(
    new PointerEvent("pointerdown", {
      pointerId: 7,
      isPrimary: true,
      button: 0,
      pointerType: "mouse",
      bubbles: true,
    }),
  );
  const selection = new Event("selectstart", { cancelable: true });
  f.viewport.dispatchEvent(selection);
  assert(selection.defaultPrevented);
  window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 7 }));
  const released = new Event("selectstart", { cancelable: true });
  f.viewport.dispatchEvent(released);
  assert(!released.defaultPrevented);
  f.cleanup();
});

test("wheel rebound is faster by default and independently configurable", async () => {
  const fast = fixture(),
    slow = fixture();
  const a = fast.mount(),
    b = slow.mount({ reboundSpring: { response: 1, dampingRatio: 1 } });
  for (const f of [fast, slow]) {
    f.viewport.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -200, cancelable: true }),
    );
  }
  await wait(800);
  assert(a.state.phase === "idle", "Default edge rebound still running");
  near(a.state.overscroll, 0, 0.1);
  assert(
    Math.abs(b.state.overscroll) > 1,
    "Custom slower response was ignored",
  );
  fast.cleanup();
  slow.cleanup();
});

for (const edge of ["top", "bottom"] as const) {
  test(`${edge}: wheel impact starts recoiling immediately and ignores its outward momentum tail`, async () => {
    const single = fixture(),
      stream = fixture();
    const a = single.mount({ reboundSpring: "smooth" });
    const b = stream.mount({ reboundSpring: "smooth" });
    const direction = edge === "top" ? -1 : 1;
    for (const [f, scroll] of [
      [single, a],
      [stream, b],
    ] as const) {
      scroll.scrollTo(direction < 0 ? 0 : scroll.state.max);
      f.viewport.dispatchEvent(
        new WheelEvent("wheel", { deltaY: direction * 220, cancelable: true }),
      );
      assert(
        scroll.state.phase === "springing",
        "Rebound waited for the wheel stream to stop",
      );
    }
    for (let i = 0; i < 20; i++) {
      await wait(16);
      stream.viewport.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: direction * (40 - i),
          cancelable: true,
        }),
      );
    }
    await wait(120);
    near(a.state.overscroll, b.state.overscroll, 0.5);
    near(a.state.velocity, b.state.velocity, 5);
    assert(b.state.phase !== "dragging", "Momentum tail restarted dragging");
    single.cleanup();
    stream.cleanup();
  });
  test(`${edge}: reversing a wheel gesture catches the rebound immediately`, () => {
    const f = fixture(),
      scroll = f.mount();
    const direction = edge === "top" ? -1 : 1;
    scroll.scrollTo(direction < 0 ? 0 : scroll.state.max);
    f.viewport.dispatchEvent(
      new WheelEvent("wheel", { deltaY: direction * 220, cancelable: true }),
    );
    assert(scroll.state.phase === "springing");
    f.viewport.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -direction * 500, cancelable: true }),
    );
    assert(
      scroll.state.position > 0 && scroll.state.position < scroll.state.max,
      "Reverse gesture was swallowed",
    );
    near(scroll.state.overscroll, 0);
    f.cleanup();
  });
}
test("a new wheel gesture can recoil again after the previous stream ends", async () => {
  const f = fixture(),
    scroll = f.mount();
  f.viewport.dispatchEvent(
    new WheelEvent("wheel", { deltaY: -200, cancelable: true }),
  );
  await wait(800);
  const settled = scroll.state;
  assert(settled.phase === "idle");
  f.viewport.dispatchEvent(
    new WheelEvent("wheel", { deltaY: -200, cancelable: true }),
  );
  assert(scroll.state.overscroll < -1);
  assert(scroll.state.phase === "springing");
  f.cleanup();
});

let passed = 0;
for (const [name, fn] of jobs) {
  const item = document.createElement("li");
  try {
    await fn();
    item.textContent = `PASS — ${name}`;
    item.className = "pass";
    passed++;
  } catch (error) {
    item.textContent = `FAIL — ${name}: ${error instanceof Error ? error.message : String(error)}`;
    item.className = "fail";
  }
  results.append(item);
}
document.querySelector("#result")!.textContent =
  `${passed}/${jobs.length} checks passed`;
