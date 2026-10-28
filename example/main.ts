import {
  createIOSScroll,
  DEFAULT_REBOUND_SPRING,
  SPRING_PRESETS,
  type IOSScroll,
  type InputType,
  type ScrollState,
  type SpringPreset,
} from "../src/index";
import "./style.css";

function $<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}
const entries = [
  ["◒", "The first light", "Before the rest of the world wakes up."],
  ["〰", "A slower route", "Take the long way home, just this once."],
  ["✳", "Room to breathe", "A little space changes everything."],
  ["◐", "An unfinished thought", "Some things are better left open."],
  ["⌁", "Water, moving", "Never quite the same river twice."],
  ["↗", "Somewhere new", "Turn left where you usually turn right."],
  ["◌", "The quiet in between", "A pause is part of the rhythm."],
  ["✧", "An ordinary wonder", "There is always something to notice."],
  ["∿", "A familiar rhythm", "The small rituals that bring us back."],
  ["◑", "Late afternoon", "When the shadows start stretching."],
  ["∴", "A few good things", "Keep a little collection of your own."],
  ["☼", "Another beginning", "There is still more out there."],
];
$("notes").innerHTML = entries
  .map(
    ([symbol, title, description]) =>
      `<li><span class="note-symbol" aria-hidden="true">${symbol}</span><div class="note-text"><strong>${title}</strong><span>${description}</span></div><span class="note-arrow" aria-hidden="true">↗</span></li>`,
  )
  .join("");
const viewport = $("demo-scroll");
const input = $<HTMLSelectElement>("input-type");
const bounce = $<HTMLInputElement>("bounce");
const reduce = $<HTMLInputElement>("reduce");
const rebound = $<HTMLInputElement>("rebound-response");
rebound.value = String(DEFAULT_REBOUND_SPRING.response * 1000);
reduce.checked = false;
let spring: SpringPreset = "smooth";
let scroller: IOSScroll;
const history: number[] = Array(80).fill(0);
let traceFrame = 0;
let traceUntil = 0;
let latest: ScrollState = {
  position: 0,
  velocity: 0,
  max: 0,
  overscroll: 0,
  phase: "idle",
};
function drawTrace(now: number): void {
  history.push(latest.velocity);
  history.shift();
  $("velocity-path").setAttribute(
    "d",
    history
      .map(
        (v, i) =>
          `${i ? "L" : "M"}${((i / 79) * 300).toFixed(1)},${(40 - Math.max(-1, Math.min(1, v / 1600)) * 30).toFixed(1)}`,
      )
      .join(" "),
  );
  traceFrame =
    now < traceUntil || latest.phase !== "idle"
      ? requestAnimationFrame(drawTrace)
      : 0;
}
function update(state: ScrollState): void {
  latest = state;
  $("position").textContent = String(Math.round(state.position));
  $("velocity").textContent = String(Math.round(state.velocity));
  $("stretch").textContent = String(Math.round(Math.abs(state.overscroll)));
  $("phase").textContent =
    state.phase === "decelerating"
      ? "Gliding"
      : state.phase === "springing"
        ? "Returning"
        : state.phase === "dragging"
          ? "Dragging"
          : "Idle";
  $("phase").dataset.active = String(state.phase !== "idle");
  if (state.phase !== "idle" && !reduce.checked) {
    traceUntil = performance.now() + 1400;
    if (!traceFrame) traceFrame = requestAnimationFrame(drawTrace);
  }
}
const snippet = () =>
  `import { createIOSScroll } from 'ios-scroll';\n\n// A fixed-height viewport. One content wrapper.\nconst scroll = createIOSScroll(\n  document.querySelector<HTMLElement>('#feed')!,\n  {\n    reboundSpring: { response: ${Number(rebound.value) / 1000}, dampingRatio: ${SPRING_PRESETS[spring].dampingRatio} },${input.value !== "touch" ? `\n    input: '${input.value}',` : ""}${!bounce.checked ? "\n    bounce: false," : ""}\n  }\n);\n\n// On unmount, call scroll.destroy().`;
function updateSnippet(): void {
  const code = snippet();
  $("integration-code").replaceChildren();
  // Fixed local code only; HTML-escape before syntax highlighting.
  $("integration-code").innerHTML = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .split("\n")
    .map((line) =>
      line.trim().startsWith("//")
        ? `<span class="code-comment">${line}</span>`
        : line
            .replace(/('[^']*')/g, '<span class="code-string">$1</span>')
            .replace(
              /\b(import|from|const)\b/g,
              '<span class="code-keyword">$1</span>',
            ),
    )
    .join("\n");
}
function mount(): void {
  const position = scroller?.state.position ?? 0;
  scroller?.destroy();
  scroller = createIOSScroll(viewport, {
    spring,
    reboundSpring: {
      response: Number(rebound.value) / 1000,
      dampingRatio: SPRING_PRESETS[spring].dampingRatio,
    },
    input: input.value as InputType,
    wheelInput: input.value as InputType,
    bounce: bounce.checked,
    reducedMotion: reduce.checked,
    onUpdate: update,
  });
  scroller.scrollTo(position);
  $("rebound-value").textContent = `${rebound.value} ms`;
  rebound.setAttribute("aria-valuetext", `${rebound.value} milliseconds`);
  updateSnippet();
}
$("spring-control").addEventListener("click", (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>(
    "button[data-spring]",
  );
  if (!button) return;
  spring = button.dataset.spring as SpringPreset;
  for (const item of $("spring-control").querySelectorAll("button"))
    item.setAttribute("aria-pressed", String(item === button));
  $("spring-hint").textContent =
    spring === "smooth"
      ? "A soft landing. No overshoot."
      : spring === "snappy"
        ? "A quick return with a little lift."
        : "A playful return. A little extra bounce.";
  mount();
});
input.addEventListener("change", mount);
rebound.addEventListener("input", mount);
bounce.addEventListener("change", mount);
reduce.addEventListener("change", () => {
  mount();
  if (reduce.checked) {
    cancelAnimationFrame(traceFrame);
    traceFrame = 0;
  }
});
$("reset").addEventListener("click", () =>
  scroller.scrollTo(0, { behavior: "smooth" }),
);
$("restore").addEventListener("click", () => {
  input.value = "touch";
  rebound.value = String(DEFAULT_REBOUND_SPRING.response * 1000);
  bounce.checked = true;
  reduce.checked = false;
  $("spring-control")
    .querySelector<HTMLButtonElement>('[data-spring="smooth"]')!
    .click();
  scroller.scrollTo(0);
});
async function copy(button: HTMLElement, text: string): Promise<void> {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "Copied ✓";
  } catch {
    button.textContent = "Copy unavailable";
  }
  setTimeout(() => {
    button.textContent = original;
  }, 1600);
}
$("copy-code").addEventListener("click", (event) => {
  void copy(event.currentTarget as HTMLElement, snippet());
});
$("copy-install").addEventListener("click", (event) => {
  void copy(
    event.currentTarget as HTMLElement,
    "npm install ./ios-scroll-0.1.0.tgz",
  );
});
mount();
