import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_REBOUND_SPRING,
  RUBBER_BAND_COEFFICIENTS,
  SPRING_PRESETS,
  inverseRubberBand,
  rubberBand,
  stepDecay,
  stepSpring,
} from "../src/physics";
import { ScrollEngine } from "../src/index";

const near = (a: number, b: number, epsilon = 1e-8) =>
  assert.ok(Math.abs(a - b) <= epsilon, `${a} ≠ ${b}`);

test("rubber band matches the article table and has a viewport ceiling", () => {
  for (const [x, expected] of [
    [25, 13.5],
    [100, 51.6],
    [844, 299.5],
    [3000, 558.4],
  ]) {
    near(rubberBand(x!, 844), expected!, 0.06);
  }
  assert.ok(rubberBand(1e12, 844) < 844);
  near(rubberBand(0.001, 844) / 0.001, 0.55, 1e-6);
  near(rubberBand(-100, 844), -rubberBand(100, 844));
});
test("resistance increases with drag, and each coefficient matches its device", () => {
  for (const c of Object.values(RUBBER_BAND_COEFFICIENTS)) {
    const smallSlope = rubberBand(101, 500, c) - rubberBand(100, 500, c);
    const largeSlope = rubberBand(1001, 500, c) - rubberBand(1000, 500, c);
    assert.ok(smallSlope > largeSlope);
    near(rubberBand(0.0001, 500, c) / 0.0001, c, 1e-6);
  }
});
test("inverse preserves a caught drag on either edge", () => {
  for (const x of [-3000, -100, 0, 100, 3000]) {
    near(inverseRubberBand(rubberBand(x, 844), 844), x);
  }
});
test("zero-sized viewports / zero resistance are safe, invalid arguments throw", () => {
  assert.equal(rubberBand(100, 0), 0);
  assert.equal(rubberBand(100, 200, 0), 0);
  for (const args of [
    [NaN, 100],
    [1, Infinity],
    [1, -1],
    [1, 100, -1],
  ]) {
    assert.throws(() => rubberBand(args[0]!, args[1]!, args[2]), RangeError);
  }
  assert.throws(() => inverseRubberBand(100, 100), RangeError);
});
test("presets use the measured response and damping values", () => {
  assert.deepEqual(SPRING_PRESETS.smooth, { response: 0.5, dampingRatio: 1 });
  assert.equal(SPRING_PRESETS.snappy.dampingRatio, 0.85);
  assert.equal(SPRING_PRESETS.bouncy.dampingRatio, 0.7);
  near(
    ((2 * Math.PI) / SPRING_PRESETS.smooth.response) ** 2,
    157.91367041742973,
  );
});
for (const dampingRatio of [0.7, 0.85, 1, 2, 4.56]) {
  test(`spring is frame-rate independent at damping ${dampingRatio}`, () => {
    const spring = { response: 0.5, dampingRatio };
    const start = { position: 300, velocity: -700 };
    const one = stepSpring(start, 20, 0.5, spring);
    for (const fps of [30, 60, 120, 144]) {
      let motion = start;
      const count = Math.round(fps / 2);
      for (let i = 0; i < count; i++)
        motion = stepSpring(motion, 20, 0.5 / count, spring);
      near(motion.position, one.position);
      near(motion.velocity, one.velocity);
    }
  });
}
test("critical spring matches its closed-form displacement and velocity", () => {
  const w = (2 * Math.PI) / 0.5,
    t = 0.12;
  const motion = stepSpring({ position: 0, velocity: 0 }, 1, t);
  near(motion.position, 1 - (1 + w * t) * Math.exp(-w * t));
  near(motion.velocity, w * w * t * Math.exp(-w * t));
  const retargeted = stepSpring(motion, 0, 0);
  near(retargeted.velocity, motion.velocity);
  near(retargeted.position, motion.position);
});
test("smooth settles without overshooting, bouncy crosses its target", () => {
  let crossed = false;
  for (let i = 0; i < 120; i++) {
    const t = i / 120;
    assert.ok(
      stepSpring({ position: 0, velocity: 0 }, 1, t, "smooth").position <= 1,
    );
    if (stepSpring({ position: 0, velocity: 0 }, 1, t, "bouncy").position > 1)
      crossed = true;
  }
  assert.ok(crossed);
});
test("decay follows per-millisecond rate and integrates distance exactly", () => {
  const start = { position: 100, velocity: 1000 };
  const next = stepDecay(start, 1);
  near(next.velocity, 1000 * 0.998 ** 1000);
  near(next.position, 100 + (1000 - next.velocity) / (-1000 * Math.log(0.998)));
  const split = stepDecay(stepDecay(start, 0.25), 0.75);
  near(split.position, next.position);
  near(split.velocity, next.velocity);
});
test("physics rejects invalid spring/decay states", () => {
  assert.throws(
    () => stepSpring({ position: 0, velocity: 0 }, 1, -1),
    RangeError,
  );
  assert.throws(
    () => stepSpring({ position: NaN, velocity: 0 }, 1, 1),
    RangeError,
  );
  assert.throws(
    () =>
      stepSpring({ position: 0, velocity: 0 }, 1, 1, {
        response: 0,
        dampingRatio: 1,
      }),
    RangeError,
  );
  for (const rate of [0, 1, -1, NaN])
    assert.throws(
      () => stepDecay({ position: 0, velocity: 1 }, 1, rate),
      RangeError,
    );
});

test("engine remains DOM-free and safe to import during SSR", () => {
  assert.equal(typeof document, "undefined");
  const engine = new ScrollEngine();
  assert.equal(engine.state.phase, "idle");
});
test("dragging moves 1:1 inside bounds and uses the rational curve outside", () => {
  const engine = new ScrollEngine({ dimension: 500, max: 1000 });
  engine.begin();
  engine.dragBy(200, 0.1);
  assert.equal(engine.state.position, 200);
  engine.dragBy(-300, 0.1);
  near(engine.state.position, -rubberBand(100, 500));
  engine.dragBy(300, 0.1);
  near(engine.state.position, 200);
  engine.dragBy(900, 0.1);
  near(engine.state.position, 1000 + rubberBand(100, 500));
});
test("catching a returning edge does not jump", () => {
  const engine = new ScrollEngine({ dimension: 500, max: 1000 });
  engine.begin();
  engine.dragBy(-200, 0.1);
  engine.release(0);
  engine.step(0.05);
  const before = engine.state.position;
  engine.begin();
  engine.dragBy(0, 0.01);
  near(engine.state.position, before);
});
test("release transitions from drag to inertia to rest", () => {
  const engine = new ScrollEngine({ dimension: 500, max: 5000 });
  engine.jumpTo(1000);
  engine.begin();
  engine.dragBy(50, 0.05);
  engine.release();
  assert.equal(engine.state.phase, "decelerating");
  for (let i = 0; i < 600; i++) engine.step(1 / 60);
  assert.equal(engine.state.phase, "idle");
  assert.equal(engine.state.velocity, 0);
  assert.ok(engine.state.position > 1050);
});
test("a paused release does not fling, and canceled overscroll returns home", () => {
  const engine = new ScrollEngine({ dimension: 500, max: 1000 });
  engine.begin();
  engine.dragBy(100, 0.02);
  engine.release(0);
  assert.equal(engine.state.phase, "idle");
  engine.begin();
  engine.dragBy(-400, 0.02);
  engine.release(0);
  assert.equal(engine.state.phase, "springing");
  engine.step(10);
  assert.equal(engine.state.position, 0);
  assert.equal(engine.state.phase, "idle");
});
test("exact inertia-to-spring crossing is independent of frame rate", () => {
  function run(steps: number) {
    const engine = new ScrollEngine({ dimension: 500, max: 1000 });
    engine.jumpTo(900);
    engine.release(1600);
    for (let i = 0; i < steps; i++) engine.step(0.25 / steps);
    return engine.state;
  }
  const one = run(1);
  assert.equal(one.phase, "springing");
  for (const count of [15, 30, 60]) {
    const many = run(count);
    near(one.position, many.position);
    near(one.velocity, many.velocity);
  }
});
test("programmatic spring retargeting preserves velocity and clamps destinations", () => {
  const engine = new ScrollEngine({ dimension: 500, max: 1000 });
  engine.animateTo(500);
  engine.step(0.12);
  const before = engine.state;
  engine.animateTo(0);
  assert.equal(engine.state.velocity, before.velocity);
  assert.equal(engine.state.position, before.position);
  engine.animateTo(2000);
  engine.step(10);
  assert.equal(engine.state.position, 1000);
});
test("resize clamps the position and cancels a stale animation target", () => {
  const engine = new ScrollEngine({ dimension: 500, max: 1000 });
  engine.jumpTo(900);
  engine.animateTo(1000);
  engine.step(0.1);
  engine.setBounds(200, 50);
  assert.equal(engine.state.position, 50);
  assert.equal(engine.state.phase, "idle");
  engine.step(1);
  assert.equal(engine.state.position, 50);
});
test("no-bounce mode clamps drag and fling at both edges", () => {
  const engine = new ScrollEngine({ dimension: 500, max: 1000, bounce: false });
  engine.begin();
  engine.dragBy(-100, 0.1);
  assert.equal(engine.state.position, 0);
  engine.release(-500);
  engine.step(0.2);
  assert.equal(engine.state.phase, "idle");
  engine.jumpTo(900);
  engine.release(1000);
  engine.step(1);
  assert.equal(engine.state.position, 1000);
  const bouncy = new ScrollEngine({
    dimension: 500,
    max: 1000,
    bounce: false,
    spring: "bouncy",
  });
  bouncy.animateTo(1000);
  bouncy.step(0.3);
  assert.ok(bouncy.state.position <= 1000);
});
test("empty content, hidden viewports and zero resistance do not produce NaN", () => {
  for (const options of [
    { dimension: 500, max: 0 },
    { dimension: 0, max: 0 },
    { dimension: 300, coefficient: 0 },
  ]) {
    const engine = new ScrollEngine(options);
    engine.begin();
    engine.dragBy(-100, 0.1);
    engine.release();
    engine.step(20);
    assert.ok(Number.isFinite(engine.state.position));
    assert.equal(engine.state.phase, "idle");
  }
});
test("engine validates public API inputs", () => {
  assert.throws(() => new ScrollEngine({ max: -1 }), RangeError);
  const engine = new ScrollEngine();
  for (const action of [
    () => engine.jumpTo(NaN),
    () => engine.animateTo(Infinity),
    () => engine.release(NaN),
    () => engine.dragBy(1, -1),
    () => engine.step(-1),
    () => engine.setBounds(0, NaN),
  ])
    assert.throws(action, RangeError);
});

for (const edge of ["top", "bottom"] as const) {
  test(`default ${edge} rebound settles faster than the previous smooth spring`, () => {
    const fast = new ScrollEngine({ dimension: 500, max: 1000 });
    const previous = new ScrollEngine({
      dimension: 500,
      max: 1000,
      reboundSpring: "smooth",
    });
    for (const engine of [fast, previous]) {
      engine.jumpTo(edge === "top" ? 0 : 1000);
      engine.begin();
      engine.dragBy(edge === "top" ? -200 : 200, 0.1);
      engine.release(0);
      engine.step(0.65);
    }
    assert.equal(fast.state.phase, "idle");
    assert.equal(fast.state.position, edge === "top" ? 0 : 1000);
    assert.ok(Math.abs(previous.state.overscroll) > 0.1);
  });
  test(`custom ${edge} rebound uses its response and damping exactly`, () => {
    const reboundSpring = { response: 0.35, dampingRatio: 0.8 };
    const engine = new ScrollEngine({
      dimension: 500,
      max: 1000,
      reboundSpring,
    });
    const target = edge === "top" ? 0 : 1000;
    engine.jumpTo(target);
    engine.begin();
    engine.dragBy(edge === "top" ? -200 : 200, 0.1);
    engine.release(0);
    const expected = stepSpring(engine.state, target, 0.1, reboundSpring);
    engine.step(0.1);
    near(engine.state.position, expected.position);
    near(engine.state.velocity, expected.velocity);
  });
}
test("edge spring and programmatic spring remain independent when retargeted", () => {
  const engine = new ScrollEngine({
    dimension: 500,
    max: 1000,
    spring: "smooth",
    reboundSpring: "interactive",
  });
  engine.begin();
  engine.dragBy(-200, 0.1);
  engine.release(0);
  engine.step(0.05);
  const before = engine.state;
  engine.animateTo(300);
  near(engine.state.velocity, before.velocity);
  const expected = stepSpring(before, 300, 0.1, "smooth");
  engine.step(0.1);
  near(engine.state.position, expected.position);
  near(engine.state.velocity, expected.velocity);
});
test("momentum uses the configured edge spring at the exact crossing time", () => {
  const reboundSpring = { response: 0.3, dampingRatio: 0.9 };
  const engine = new ScrollEngine({ dimension: 500, max: 1000, reboundSpring });
  engine.jumpTo(900);
  engine.release(1600);
  const k = -1000 * Math.log(0.998);
  const hit = -Math.log1p((-100 * k) / 1600) / k;
  const expected = stepSpring(
    { position: 1000, velocity: 1600 * Math.exp(-k * hit) },
    1000,
    0.2 - hit,
    reboundSpring,
  );
  engine.step(0.2);
  near(engine.state.position, expected.position);
  near(engine.state.velocity, expected.velocity);
});
test("invalid rebound parameters fail eagerly", () => {
  for (const reboundSpring of [
    { response: 0, dampingRatio: 1 },
    { response: 0.2, dampingRatio: NaN },
  ]) {
    assert.throws(() => new ScrollEngine({ reboundSpring }), RangeError);
  }
});

for (const edge of ["top", "bottom"] as const) {
  test(`${edge}: fast-scroll recoil matches a touch release from the same stretch`, () => {
    const target = edge === "top" ? 0 : 1000;
    const direction = edge === "top" ? -1 : 1;
    const fling = new ScrollEngine({ dimension: 500, max: 1000 });
    fling.jumpTo(target - direction * 100);
    fling.release(direction * 1600);
    const k = -1000 * Math.log(0.998);
    const hitTime = -Math.log1p((-100 * k) / 1600) / k;
    // At the apex a critically damped impact has exactly zero velocity.
    fling.step(hitTime + DEFAULT_REBOUND_SPRING.response / (2 * Math.PI));
    near(fling.state.velocity, 0);
    const touch = new ScrollEngine({ dimension: 500, max: 1000 });
    touch.jumpTo(target);
    touch.begin();
    touch.dragBy(inverseRubberBand(fling.state.overscroll, 500), 0);
    touch.release(0);
    near(touch.state.position, fling.state.position);
    for (let frame = 0; frame < 60; frame++) {
      touch.step(1 / 120);
      fling.step(1 / 120);
      near(touch.state.position, fling.state.position);
      near(touch.state.velocity, fling.state.velocity);
      assert.equal(touch.state.phase, fling.state.phase);
    }
  });
}
