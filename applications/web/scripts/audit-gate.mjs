// CI dependency gate: fail on any high or critical npm advisory, except
// advisories listed below with a reason and an expiry. An exception is only for
// an advisory with no patched release. It lapses on its date, so CI fails again
// and someone has to review it rather than it being forgotten.
import { execFileSync } from "node:child_process";

const EXCEPTIONS = [
  {
    url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
    reason:
      "braces <=3.0.3 has no patched release; reached only through the dev-only " +
      "eslint-config-next -> @next/eslint-plugin-next -> fast-glob lint chain.",
    expires: "2026-11-09",
  },
];

const BLOCKING = new Set(["high", "critical"]);
let raw;
try {
  raw = execFileSync("npm", ["audit", "--json"], { encoding: "utf8" });
} catch (error) {
  // npm audit exits non-zero when it finds advisories; its JSON is still on stdout.
  raw = error.stdout;
}
const report = JSON.parse(raw);
if (report.error) {
  console.error(`npm audit failed: ${report.error.summary ?? report.error.code}`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const advisories = new Map();
for (const vulnerability of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vulnerability.via) {
    if (typeof via === "object" && BLOCKING.has(via.severity)) {
      advisories.set(via.url, { ...via, package: vulnerability.name });
    }
  }
}

const failures = [];
for (const advisory of advisories.values()) {
  const exception = EXCEPTIONS.find((e) => e.url === advisory.url);
  if (exception && exception.expires >= today) {
    console.log(
      `excepted until ${exception.expires}: ${advisory.package} ${advisory.url} (${exception.reason})`,
    );
    continue;
  }
  failures.push(advisory);
}

for (const advisory of failures) {
  console.error(
    `${advisory.severity}: ${advisory.package} ${advisory.range} ${advisory.title} ${advisory.url}`,
  );
}
if (failures.length) process.exit(1);
console.log("No unexcepted high or critical advisories.");
