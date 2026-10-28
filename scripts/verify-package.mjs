// Exercise the actual tarball as a consumer, including both NodeNext type branches.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = mkdtempSync(join(tmpdir(), "ios-scroll-package-"));
const run = (command, args, cwd = temp) =>
  execFileSync(command, args, { cwd, stdio: "pipe", encoding: "utf8" });
try {
  const output = run(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", temp],
    root,
  );
  const [{ filename }] = JSON.parse(output);
  writeFileSync(
    join(temp, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  run("npm", [
    "install",
    "--ignore-scripts",
    "--offline",
    "--no-audit",
    "--no-fund",
    join(temp, filename),
  ]);
  const fixture = `import { createIOSScroll, ScrollEngine, type IOSScrollOptions } from 'ios-scroll';
import { rubberBand, stepSpring } from 'ios-scroll/physics';
const options: IOSScrollOptions = { spring: 'bouncy', input: 'touch', reboundSpring: { response: 0.18, dampingRatio: 1 } };
const engine = new ScrollEngine({ dimension: 500, max: 1000 });
engine.begin(); engine.dragBy(100, 0.016); engine.release();
if (Math.abs(rubberBand(100, 844) - 51.63515016685206) > 0.001) throw new Error('Bad resistance');
if (!Number.isFinite(stepSpring({ position: 10, velocity: 0 }, 0, 0.1).position)) throw new Error('Bad spring');
if (typeof createIOSScroll !== 'function') throw new Error('Missing adapter');
void options;
`;
  writeFileSync(join(temp, "consumer.mts"), fixture);
  writeFileSync(join(temp, "consumer.cts"), fixture);
  run(process.execPath, [
    resolve(root, "node_modules/typescript/bin/tsc"),
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "--target",
    "ES2020",
    "--strict",
    "--outDir",
    "out",
    "consumer.mts",
    "consumer.cts",
  ]);
  run(process.execPath, ["out/consumer.mjs"]);
  run(process.execPath, ["out/consumer.cjs"]);
  const pkg = JSON.parse(
    readFileSync(join(temp, "node_modules/ios-scroll/package.json"), "utf8"),
  );
  if (pkg.dependencies && Object.keys(pkg.dependencies).length)
    throw new Error("Unexpected runtime dependencies");
  console.log(
    "Package verified: tarball install, ESM, CommonJS, NodeNext declarations, SSR import and pure physics exports.",
  );
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout);
  if (error.stderr) process.stderr.write(error.stderr);
  throw error;
} finally {
  rmSync(temp, { recursive: true, force: true });
}
