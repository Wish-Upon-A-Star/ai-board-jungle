import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const reportsDir = "docs/evaluation-reports";
const reportPattern = /^(\d{4}-\d{2}-\d{2})-round-(\d{2,})\.md$/;

export function readEvaluationReportRounds() {
  const files = readdirSync(reportsDir).filter((file) => reportPattern.test(file));
  assert.ok(files.length > 0, "evaluation reports must exist");
  return files.map((file) => {
    const match = file.match(reportPattern);
    return { file, round: Number(match[2]) };
  }).sort((a, b) => a.round - b.round);
}

export function assertEvaluationReportRounds(rounds) {
  const seen = new Set();
  for (let index = 0; index < rounds.length; index += 1) {
    const { file, round } = rounds[index];
    assert.equal(seen.has(round), false, `duplicate evaluation report round ${round}`);
    const expected = index + 1;
    assert.equal(round, expected, `expected round ${String(expected).padStart(2, "0")} but found ${file}`);
    seen.add(round);

    const content = readFileSync(join(reportsDir, file), "utf8");
    assert.ok(/Functionality:\s*\d+(?:\.\d+)?\/10/.test(content), `${file} missing functionality score`);
    assert.ok(/Tests?:\s*\d+(?:\.\d+)?\/10/.test(content), `${file} missing test score`);
    assert.ok(/Next (Risks|risks|Improvement Targets|Work Targets)/.test(content), `${file} missing next risk/improvement section`);
  }
  return rounds;
}

export function getLatestEvaluationRound() {
  const rounds = assertEvaluationReportRounds(readEvaluationReportRounds());
  return rounds.at(-1).round;
}

export function buildEvaluationReportSummary(rounds) {
  assertEvaluationReportRounds(rounds);
  return {
    ok: true,
    checked: rounds.length,
    first: rounds[0].file,
    latest: rounds.at(-1).file,
    latestRound: rounds.at(-1).round,
  };
}

const rounds = assertEvaluationReportRounds(readEvaluationReportRounds());
const summary = buildEvaluationReportSummary(rounds);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(summary, null, 2));
}
