import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const reportsDir = "docs/evaluation-reports";
const reportPattern = /^(\d{4}-\d{2}-\d{2})-round-(\d{2,})\.md$/;
const files = readdirSync(reportsDir).filter((file) => reportPattern.test(file));
assert.ok(files.length > 0, "evaluation reports must exist");

const rounds = files.map((file) => {
  const match = file.match(reportPattern);
  return { file, round: Number(match[2]) };
}).sort((a, b) => a.round - b.round);

const seen = new Set();
for (let index = 0; index < rounds.length; index += 1) {
  const expected = index + 1;
  const { file, round } = rounds[index];
  assert.equal(round, expected, `expected round ${String(expected).padStart(2, "0")} but found ${file}`);
  assert.equal(seen.has(round), false, `duplicate evaluation report round ${round}`);
  seen.add(round);

  const content = readFileSync(join(reportsDir, file), "utf8");
  assert.ok(/Functionality:\s*\d+(?:\.\d+)?\/10/.test(content), `${file} missing functionality score`);
  assert.ok(/Tests?:\s*\d+(?:\.\d+)?\/10/.test(content), `${file} missing test score`);
  assert.ok(/Next (Risks|risks|Improvement Targets|Work Targets)/.test(content), `${file} missing next risk/improvement section`);
}

console.log(JSON.stringify({
  ok: true,
  checked: rounds.length,
  first: rounds[0].file,
  latest: rounds.at(-1).file,
  latestRound: rounds.at(-1).round,
}, null, 2));
