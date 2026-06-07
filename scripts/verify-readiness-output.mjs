import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { serverRequiredCommands } from "./verification-command-lists.mjs";
import { getLatestEvaluationRound } from "./verify-evaluation-reports.mjs";
import { expectedChecklistCommands, expectedChecklistItems } from "./verify-readme-contract.mjs";

const expectedServerRequiredLine = `server-required: ${serverRequiredCommands.join(", ")}`;
const expectedReadinessNote = "This readiness summary does not start FastAPI, Vite, or Chrome CDP. Run npm run verify:full:quick for end-to-end smoke.";
const expectedLatestEvaluationRound = getLatestEvaluationRound();
const requiredLines = [
  "PASS hygiene",
  "PASS text",
  "PASS text output",
  "PASS frontend helpers",
  "PASS template presets",
  "PASS evaluation reports",
  "PASS readme",
  "PASS readme output",
  "PASS readiness output fixture",
  "PASS command scope",
  "PASS backend syntax",
];

const expectedFailureFlags = [
  "missingScannedFileCountFails",
  "nonEmptyMissingRequiredFilesFails",
  "missingRequiredScannedFilesFails",
  "missingReadmeResultFails",
  "missingChecklistCommandsFails",
  "staleChecklistCommandsFails",
  "missingChecklistItemsFails",
  "staleChecklistItemsFails",
];

const expectedDirectHelperNegativeScenarios = [
  "missingDirectHelperNegativeGuards",
  "staleDirectHelperNegativeGuards",
  "partialDirectHelperNegativeGuards",
  "reversedPartialDirectHelperNegativeGuards",
];

const expectedDirectHelperNegativeGuards = [
  "missingEvidenceIndex",
  "stringEvidenceIndex",
];

const expectedNegativeFixtureGuards = [
  "extraBooleanFailureField",
  "missingBooleanFailureField",
];

const expectedPositiveFixtureGuards = [
  "validFixtureSummaryIndexes",
];

const expectedEvaluationReportNegativeGuards = [
  "truncatedEvaluationReportRounds",
  "duplicateEvaluationReportRounds",
];

const expectedReadinessOutputCliIndexPositiveGuards = [
  "validReadinessOutputCliIndexOrder",
];

const expectedReadinessOutputCliIndexPositiveGuardNegativeScenarios = [
  "staleReadinessOutputCliIndexPositiveGuardsIndex",
  "staleReadinessOutputCliIndexNegativeScenariosIndex",
  "misplacedReadinessOutputCliIndexNegativeScenariosIndex",
];

const expectedReadinessOutputCliIndexNegativeScenarios = [
  "staleEvaluationReportNegativeGuardsIndex",
  "misplacedEvaluationReportNegativeGuardsIndex",
];

const expectedReadinessSummaryNegativeGuards = [
  "missingServerRequiredCommands",
  "missingReadinessNote",
  "missingCompactReadinessNote",
];

const expectedCompactReadinessNegativeGuards = [
  "missingCompactTotal",
  "missingCompactLatestRound",
  "missingCompactServerRequiredLine",
  "missingCompactPassLine",
];

const expectedFailedCompactReadinessNegativeGuards = [
  "missingFailedCompactStatus",
  "missingFailedCompactLine",
  "missingFailedCompactSummary",
];

const expectedFailedCompactReadinessCliGuards = [
  "syntheticFailedCompactCliExit",
  "syntheticFailedCompactCliStatus",
  "syntheticFailedCompactCliLine",
  "syntheticFailedCompactCliSummary",
];

export const expectedFixtureSummaryKeys = Object.freeze([
  "ok",
  "checked",
  "validScannedFileCount",
  "failureFlags",
  "positiveFixtureGuards",
  "negativeFixtureGuards",
  "directHelperNegativeGuards",
  "directHelperNegativeScenarios",
  "evaluationReportNegativeGuards",
  "readinessOutputCliIndexPositiveGuards",
  "readinessOutputCliIndexPositiveGuardNegativeScenarios",
  "readinessOutputCliIndexNegativeScenarios",
  "readinessSummaryNegativeGuards",
  "compactReadinessNegativeGuards",
  "failedCompactReadinessNegativeGuards",
  "failedCompactReadinessCliGuards",
  ...expectedFailureFlags,
]);

export function assertCompactReadinessOutput(output) {
  assert.ok(output.includes("READINESS OK 11/11 passed"), "compact output must include the readiness total");
  assert.ok(
    output.includes(`latest-evaluation-round: ${expectedLatestEvaluationRound}`),
    "compact output must include the latest evaluation report round"
  );
  assert.ok(output.includes(expectedServerRequiredLine), "compact output must list server-required checks");
  assert.ok(output.includes(`NOTE ${expectedReadinessNote}`), "compact output must include the server-required warning note");
  assert.ok(output.includes("FastAPI, Vite, or Chrome CDP"), "compact output must name the servers it does not start");
  assert.ok(output.includes("npm run verify:full:quick"), "compact output must name the end-to-end smoke command");

  for (const line of requiredLines) {
    assert.ok(output.includes(line), `compact output missing ${line}`);
  }
}

export function assertFailedCompactReadinessOutput(output, {
  failedCheckName,
  expectedSummary,
} = {}) {
  assert.ok(output.includes("READINESS FAILED"), "failed compact output must include failed readiness status");
  assert.ok(failedCheckName, "failed compact output assertion must name the failed check");
  assert.ok(expectedSummary, "failed compact output assertion must name the expected failure summary");
  assert.ok(output.includes(`FAIL ${failedCheckName}`), `failed compact output must include FAIL ${failedCheckName}`);
  assert.ok(
    output.includes(expectedSummary),
    `failed compact output must include captured summary for ${failedCheckName}`
  );
}

export function assertFixtureSummaryIndexes(fixtureSummaryIndexes) {
  assert.ok(
    Object.values(fixtureSummaryIndexes).every((index) => Number.isInteger(index) && index >= 0),
    "readiness output fixture summary indexes must be non-negative integers"
  );
}

export function assertFixtureEvidenceOrder({
  failureFlagsIndex,
  positiveFixtureGuardsIndex,
  negativeFixtureGuardsIndex,
  directHelperNegativeGuardsIndex,
  directHelperNegativeScenariosIndex,
  evaluationReportNegativeGuardsIndex,
  readinessOutputCliIndexPositiveGuardsIndex,
  readinessOutputCliIndexPositiveGuardNegativeScenariosIndex,
  readinessOutputCliIndexNegativeScenariosIndex,
  readinessSummaryNegativeGuardsIndex,
  compactReadinessNegativeGuardsIndex,
  failedCompactReadinessNegativeGuardsIndex,
  failedCompactReadinessCliGuardsIndex,
  firstBooleanFailureFieldIndex,
}) {
  assertFixtureSummaryIndexes({
    failureFlagsIndex,
    positiveFixtureGuardsIndex,
    negativeFixtureGuardsIndex,
    directHelperNegativeGuardsIndex,
    directHelperNegativeScenariosIndex,
    evaluationReportNegativeGuardsIndex,
    readinessOutputCliIndexPositiveGuardsIndex,
    readinessOutputCliIndexPositiveGuardNegativeScenariosIndex,
    readinessOutputCliIndexNegativeScenariosIndex,
    readinessSummaryNegativeGuardsIndex,
    compactReadinessNegativeGuardsIndex,
    failedCompactReadinessNegativeGuardsIndex,
    failedCompactReadinessCliGuardsIndex,
    firstBooleanFailureFieldIndex,
  });
  assert.ok(
    failureFlagsIndex >= 0
      && positiveFixtureGuardsIndex > failureFlagsIndex
      && negativeFixtureGuardsIndex > positiveFixtureGuardsIndex
      && directHelperNegativeGuardsIndex > negativeFixtureGuardsIndex
      && directHelperNegativeScenariosIndex > directHelperNegativeGuardsIndex
      && evaluationReportNegativeGuardsIndex > directHelperNegativeScenariosIndex
      && readinessOutputCliIndexPositiveGuardsIndex > evaluationReportNegativeGuardsIndex
      && readinessOutputCliIndexPositiveGuardNegativeScenariosIndex > readinessOutputCliIndexPositiveGuardsIndex
      && readinessOutputCliIndexNegativeScenariosIndex > readinessOutputCliIndexPositiveGuardNegativeScenariosIndex
      && readinessSummaryNegativeGuardsIndex > readinessOutputCliIndexNegativeScenariosIndex
      && compactReadinessNegativeGuardsIndex > readinessSummaryNegativeGuardsIndex
      && failedCompactReadinessNegativeGuardsIndex > compactReadinessNegativeGuardsIndex
      && failedCompactReadinessCliGuardsIndex > failedCompactReadinessNegativeGuardsIndex
      && firstBooleanFailureFieldIndex > failedCompactReadinessCliGuardsIndex,
    "readiness output fixture summary must list failureFlags, positiveFixtureGuards, negativeFixtureGuards, directHelperNegativeGuards, directHelperNegativeScenarios, evaluationReportNegativeGuards, readinessOutputCliIndexPositiveGuards, readinessOutputCliIndexPositiveGuardNegativeScenarios, readinessOutputCliIndexNegativeScenarios, readinessSummaryNegativeGuards, compactReadinessNegativeGuards, failedCompactReadinessNegativeGuards, failedCompactReadinessCliGuards, then boolean *Fails fields"
  );
}

export function assertFixtureSummaryKeySchema(fixtureOutput) {
  assert.deepEqual(
    Object.keys(fixtureOutput),
    expectedFixtureSummaryKeys,
    "readiness output fixture summary must list top-level keys in the expected schema order"
  );
}

export function assertFixtureSummaryKeyCount(fixtureOutput, expectedKeyCount = expectedFixtureSummaryKeys.length) {
  const fixtureSummaryKeyCount = Object.keys(fixtureOutput).length;
  assert.equal(
    fixtureSummaryKeyCount,
    expectedKeyCount,
    "readiness output fixture summary key count must match exported schema length"
  );
  return fixtureSummaryKeyCount;
}

export function assertReadinessOutputCliIndexes(fixtureSummaryIndexes) {
  assert.ok(
    fixtureSummaryIndexes.evaluationReportNegativeGuardsIndex
      > fixtureSummaryIndexes.directHelperNegativeScenariosIndex,
    "verify:readiness-output CLI must place evaluationReportNegativeGuardsIndex after directHelperNegativeScenariosIndex"
  );
  assert.ok(
    fixtureSummaryIndexes.readinessOutputCliIndexPositiveGuardsIndex
      > fixtureSummaryIndexes.evaluationReportNegativeGuardsIndex,
    "verify:readiness-output CLI must place readinessOutputCliIndexPositiveGuardsIndex after evaluationReportNegativeGuardsIndex"
  );
  assert.ok(
    fixtureSummaryIndexes.readinessOutputCliIndexPositiveGuardNegativeScenariosIndex
      > fixtureSummaryIndexes.readinessOutputCliIndexPositiveGuardsIndex,
    "verify:readiness-output CLI must place readinessOutputCliIndexPositiveGuardNegativeScenariosIndex after readinessOutputCliIndexPositiveGuardsIndex"
  );
  assert.ok(
    fixtureSummaryIndexes.readinessOutputCliIndexNegativeScenariosIndex
      > fixtureSummaryIndexes.readinessOutputCliIndexPositiveGuardNegativeScenariosIndex,
    "verify:readiness-output CLI must place readinessOutputCliIndexNegativeScenariosIndex after readinessOutputCliIndexPositiveGuardNegativeScenariosIndex"
  );
  assert.ok(
    fixtureSummaryIndexes.firstBooleanFailureFieldIndex
      > fixtureSummaryIndexes.readinessOutputCliIndexNegativeScenariosIndex,
    "verify:readiness-output CLI must place firstBooleanFailureFieldIndex after readinessOutputCliIndexNegativeScenariosIndex"
  );
  assert.ok(
    fixtureSummaryIndexes.readinessSummaryNegativeGuardsIndex
      > fixtureSummaryIndexes.readinessOutputCliIndexNegativeScenariosIndex,
    "verify:readiness-output CLI must place readinessSummaryNegativeGuardsIndex after readinessOutputCliIndexNegativeScenariosIndex"
  );
  assert.ok(
    fixtureSummaryIndexes.firstBooleanFailureFieldIndex
      > fixtureSummaryIndexes.readinessSummaryNegativeGuardsIndex,
    "verify:readiness-output CLI must place firstBooleanFailureFieldIndex after readinessSummaryNegativeGuardsIndex"
  );
  assert.ok(
    fixtureSummaryIndexes.compactReadinessNegativeGuardsIndex
      > fixtureSummaryIndexes.readinessSummaryNegativeGuardsIndex,
    "verify:readiness-output CLI must place compactReadinessNegativeGuardsIndex after readinessSummaryNegativeGuardsIndex"
  );
  assert.ok(
    fixtureSummaryIndexes.firstBooleanFailureFieldIndex
      > fixtureSummaryIndexes.compactReadinessNegativeGuardsIndex,
    "verify:readiness-output CLI must place firstBooleanFailureFieldIndex after compactReadinessNegativeGuardsIndex"
  );
  assert.ok(
    fixtureSummaryIndexes.failedCompactReadinessNegativeGuardsIndex
      > fixtureSummaryIndexes.compactReadinessNegativeGuardsIndex,
    "verify:readiness-output CLI must place failedCompactReadinessNegativeGuardsIndex after compactReadinessNegativeGuardsIndex"
  );
  assert.ok(
    fixtureSummaryIndexes.firstBooleanFailureFieldIndex
      > fixtureSummaryIndexes.failedCompactReadinessNegativeGuardsIndex,
    "verify:readiness-output CLI must place firstBooleanFailureFieldIndex after failedCompactReadinessNegativeGuardsIndex"
  );
  assert.ok(
    fixtureSummaryIndexes.failedCompactReadinessCliGuardsIndex
      > fixtureSummaryIndexes.failedCompactReadinessNegativeGuardsIndex,
    "verify:readiness-output CLI must place failedCompactReadinessCliGuardsIndex after failedCompactReadinessNegativeGuardsIndex"
  );
  assert.ok(
    fixtureSummaryIndexes.firstBooleanFailureFieldIndex
      > fixtureSummaryIndexes.failedCompactReadinessCliGuardsIndex,
    "verify:readiness-output CLI must place firstBooleanFailureFieldIndex after failedCompactReadinessCliGuardsIndex"
  );
}

export function assertReadinessJsonEvidence(readinessSummary, { requireFixtureSummary = false } = {}) {
  let fixtureSummaryIndexes = null;
  let fixtureSummaryKeyCount = null;
  let readinessFixtureOutput = null;
  const readmeResult = readinessSummary.results.find((item) => item.name === "readme");
  assert.ok(readmeResult, "json readiness must include readme result");
  const readmeOutputResult = readinessSummary.results.find((item) => item.name === "readme output");
  assert.ok(readmeOutputResult, "json readiness must include readme output result");
  const textOutputResult = readinessSummary.results.find((item) => item.name === "text output");
  assert.ok(textOutputResult, "json readiness must include text output result");
  const evaluationReportsResult = readinessSummary.results.find((item) => item.name === "evaluation reports");
  assert.ok(evaluationReportsResult, "json readiness must include evaluation reports result");
  assert.equal(
    readinessSummary.latestEvaluationRound,
    expectedLatestEvaluationRound,
    "json readiness must expose the latest evaluation report round"
  );
  assert.deepEqual(
    readinessSummary.serverRequired,
    serverRequiredCommands,
    "json readiness must expose the server-required command list"
  );
  assert.equal(
    readinessSummary.note,
    expectedReadinessNote,
    "json readiness must expose the server-required warning note"
  );
  assert.ok(
    evaluationReportsResult.summary.includes(`"latestRound": ${expectedLatestEvaluationRound}`),
    "evaluation reports summary must include the latest report round"
  );
  const readinessFixtureResult = readinessSummary.results.find((item) => item.name === "readiness output fixture");
  if (requireFixtureSummary) {
    assert.ok(readinessFixtureResult, "json readiness must include readiness output fixture result");
  }
  assert.ok(
    readmeResult.summary.includes(`"checklistCommands": ${expectedChecklistCommands}`),
    "readme summary must include checklistCommands count"
  );
  assert.ok(
    readmeResult.summary.includes(`"checklistItems": ${expectedChecklistItems}`),
    "readme summary must include checklistItems count"
  );
  assert.ok(
    readmeOutputResult.summary.includes('"readmeChecked": "README.md"'),
    "readme output summary must include README identity evidence"
  );
  assert.ok(
    readmeOutputResult.summary.includes('"checklistPath": "docs/submission-checklist.md"'),
    "readme output summary must include checklist path evidence"
  );
  assert.ok(
    readmeOutputResult.summary.includes('"required":'),
    "readme output summary must include required snippet count evidence"
  );
  assert.ok(
    readmeOutputResult.summary.includes(`"checklistCommands": ${expectedChecklistCommands}`),
    "readme output summary must include checklistCommands count"
  );
  assert.ok(
    readmeOutputResult.summary.includes(`"checklistItems": ${expectedChecklistItems}`),
    "readme output summary must include checklistItems count"
  );
  assert.ok(
    textOutputResult.summary.includes('"scannedFileCount":'),
    "text output summary must include scannedFileCount"
  );
  assert.ok(
    textOutputResult.summary.includes('"requiredScannedFiles":'),
    "text output summary must include requiredScannedFiles"
  );
  assert.ok(
    textOutputResult.summary.includes('"scripts/verify-readme-contract.mjs"'),
    "text output summary must include the README contract helper"
  );
  assert.ok(
    textOutputResult.summary.includes('"missingRequiredFiles": []'),
    "text output summary must include missingRequiredFiles empty evidence"
  );
  if (requireFixtureSummary) {
    assert.ok(
      readinessFixtureResult.summary.includes('"failureFlags": ['),
      "readiness output fixture summary must include failureFlags list"
    );
    assert.doesNotThrow(
      () => { readinessFixtureOutput = JSON.parse(readinessFixtureResult.summary); },
      "readiness output fixture summary must be valid JSON"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"missingScannedFileCountFails"'),
      "readiness output fixture summary must include first failure flag"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"staleChecklistItemsFails"'),
      "readiness output fixture summary must include last failure flag"
    );
    assert.deepEqual(
      readinessFixtureOutput.failureFlags,
      expectedFailureFlags,
      "readiness output fixture summary must list failureFlags in the expected order"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"negativeFixtureGuards": ['),
      "readiness output fixture summary must include negativeFixtureGuards list"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"directHelperNegativeGuards": ['),
      "readiness output fixture summary must include directHelperNegativeGuards list"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"directHelperNegativeScenarios": ['),
      "readiness output fixture summary must include directHelperNegativeScenarios list"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"evaluationReportNegativeGuards": ['),
      "readiness output fixture summary must include evaluationReportNegativeGuards list"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"positiveFixtureGuards": ['),
      "readiness output fixture summary must include positiveFixtureGuards list"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"validFixtureSummaryIndexes"'),
      "readiness output fixture summary must include valid index-shape positive guard"
    );
    assert.deepEqual(
      readinessFixtureOutput.positiveFixtureGuards,
      expectedPositiveFixtureGuards,
      "readiness output fixture summary must list positiveFixtureGuards in the expected order"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"extraBooleanFailureField"'),
      "readiness output fixture summary must include extra-field negative guard"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"missingBooleanFailureField"'),
      "readiness output fixture summary must include missing-field negative guard"
    );
    assert.deepEqual(
      readinessFixtureOutput.negativeFixtureGuards,
      expectedNegativeFixtureGuards,
      "readiness output fixture summary must list negativeFixtureGuards in the expected order"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"missingEvidenceIndex"'),
      "readiness output fixture summary must include missing evidence index direct helper guard"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"stringEvidenceIndex"'),
      "readiness output fixture summary must include string evidence index direct helper guard"
    );
    assert.deepEqual(
      readinessFixtureOutput.directHelperNegativeGuards,
      expectedDirectHelperNegativeGuards,
      "readiness output fixture summary must list directHelperNegativeGuards in the expected order"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"missingDirectHelperNegativeGuards"'),
      "readiness output fixture summary must include missing direct helper guard scenario"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"staleDirectHelperNegativeGuards"'),
      "readiness output fixture summary must include stale direct helper guard scenario"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"partialDirectHelperNegativeGuards"'),
      "readiness output fixture summary must include partial direct helper guard scenario"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"reversedPartialDirectHelperNegativeGuards"'),
      "readiness output fixture summary must include reversed partial direct helper guard scenario"
    );
    assert.deepEqual(
      readinessFixtureOutput.directHelperNegativeScenarios,
      expectedDirectHelperNegativeScenarios,
      "readiness output fixture summary must list directHelperNegativeScenarios in the expected order"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"truncatedEvaluationReportRounds"'),
      "readiness output fixture summary must include truncated evaluation report guard"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"duplicateEvaluationReportRounds"'),
      "readiness output fixture summary must include duplicate evaluation report guard"
    );
    assert.deepEqual(
      readinessFixtureOutput.evaluationReportNegativeGuards,
      expectedEvaluationReportNegativeGuards,
      "readiness output fixture summary must list evaluationReportNegativeGuards in the expected order"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"readinessOutputCliIndexPositiveGuards": ['),
      "readiness output fixture summary must include readinessOutputCliIndexPositiveGuards list"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"validReadinessOutputCliIndexOrder"'),
      "readiness output fixture summary must include valid readiness CLI index positive guard"
    );
    assert.deepEqual(
      readinessFixtureOutput.readinessOutputCliIndexPositiveGuards,
      expectedReadinessOutputCliIndexPositiveGuards,
      "readiness output fixture summary must list readinessOutputCliIndexPositiveGuards in the expected order"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"readinessOutputCliIndexPositiveGuardNegativeScenarios": ['),
      "readiness output fixture summary must include readinessOutputCliIndexPositiveGuardNegativeScenarios list"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"staleReadinessOutputCliIndexPositiveGuardsIndex"'),
      "readiness output fixture summary must include stale CLI positive guard index negative scenario"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"staleReadinessOutputCliIndexNegativeScenariosIndex"'),
      "readiness output fixture summary must include stale CLI negative scenarios index negative scenario"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"misplacedReadinessOutputCliIndexNegativeScenariosIndex"'),
      "readiness output fixture summary must include misplaced CLI negative scenarios index negative scenario"
    );
    assert.deepEqual(
      readinessFixtureOutput.readinessOutputCliIndexPositiveGuardNegativeScenarios,
      expectedReadinessOutputCliIndexPositiveGuardNegativeScenarios,
      "readiness output fixture summary must list readinessOutputCliIndexPositiveGuardNegativeScenarios in the expected order"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"readinessOutputCliIndexNegativeScenarios": ['),
      "readiness output fixture summary must include readinessOutputCliIndexNegativeScenarios list"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"staleEvaluationReportNegativeGuardsIndex"'),
      "readiness output fixture summary must include stale CLI index negative scenario"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"misplacedEvaluationReportNegativeGuardsIndex"'),
      "readiness output fixture summary must include misplaced CLI index negative scenario"
    );
    assert.deepEqual(
      readinessFixtureOutput.readinessOutputCliIndexNegativeScenarios,
      expectedReadinessOutputCliIndexNegativeScenarios,
      "readiness output fixture summary must list readinessOutputCliIndexNegativeScenarios in the expected order"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"readinessSummaryNegativeGuards": ['),
      "readiness output fixture summary must include readinessSummaryNegativeGuards list"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"missingServerRequiredCommands"'),
      "readiness output fixture summary must include missing server-required commands guard"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"missingReadinessNote"'),
      "readiness output fixture summary must include missing JSON readiness note guard"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"missingCompactReadinessNote"'),
      "readiness output fixture summary must include missing compact readiness note guard"
    );
    assert.deepEqual(
      readinessFixtureOutput.readinessSummaryNegativeGuards,
      expectedReadinessSummaryNegativeGuards,
      "readiness output fixture summary must list readinessSummaryNegativeGuards in the expected order"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"compactReadinessNegativeGuards": ['),
      "readiness output fixture summary must include compactReadinessNegativeGuards list"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"missingCompactTotal"'),
      "readiness output fixture summary must include missing compact total guard"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"missingCompactLatestRound"'),
      "readiness output fixture summary must include missing compact latest round guard"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"missingCompactServerRequiredLine"'),
      "readiness output fixture summary must include missing compact server-required line guard"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"missingCompactPassLine"'),
      "readiness output fixture summary must include missing compact PASS line guard"
    );
    assert.deepEqual(
      readinessFixtureOutput.compactReadinessNegativeGuards,
      expectedCompactReadinessNegativeGuards,
      "readiness output fixture summary must list compactReadinessNegativeGuards in the expected order"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"failedCompactReadinessNegativeGuards": ['),
      "readiness output fixture summary must include failedCompactReadinessNegativeGuards list"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"missingFailedCompactStatus"'),
      "readiness output fixture summary must include missing failed compact status guard"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"missingFailedCompactLine"'),
      "readiness output fixture summary must include missing failed compact FAIL line guard"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"missingFailedCompactSummary"'),
      "readiness output fixture summary must include missing failed compact summary guard"
    );
    assert.deepEqual(
      readinessFixtureOutput.failedCompactReadinessNegativeGuards,
      expectedFailedCompactReadinessNegativeGuards,
      "readiness output fixture summary must list failedCompactReadinessNegativeGuards in the expected order"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"failedCompactReadinessCliGuards": ['),
      "readiness output fixture summary must include failedCompactReadinessCliGuards list"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"syntheticFailedCompactCliExit"'),
      "readiness output fixture summary must include synthetic failed compact CLI exit guard"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"syntheticFailedCompactCliStatus"'),
      "readiness output fixture summary must include synthetic failed compact CLI status guard"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"syntheticFailedCompactCliLine"'),
      "readiness output fixture summary must include synthetic failed compact CLI line guard"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"syntheticFailedCompactCliSummary"'),
      "readiness output fixture summary must include synthetic failed compact CLI summary guard"
    );
    assert.deepEqual(
      readinessFixtureOutput.failedCompactReadinessCliGuards,
      expectedFailedCompactReadinessCliGuards,
      "readiness output fixture summary must list failedCompactReadinessCliGuards in the expected order"
    );
    const failureFlagsIndex = readinessFixtureResult.summary.indexOf('"failureFlags": [');
    const positiveFixtureGuardsIndex = readinessFixtureResult.summary.indexOf('"positiveFixtureGuards": [');
    const negativeFixtureGuardsIndex = readinessFixtureResult.summary.indexOf('"negativeFixtureGuards": [');
    const directHelperNegativeGuardsIndex = readinessFixtureResult.summary.indexOf('"directHelperNegativeGuards": [');
    const directHelperNegativeScenariosIndex = readinessFixtureResult.summary.indexOf('"directHelperNegativeScenarios": [');
    const evaluationReportNegativeGuardsIndex = readinessFixtureResult.summary.indexOf('"evaluationReportNegativeGuards": [');
    const readinessOutputCliIndexPositiveGuardsIndex = readinessFixtureResult.summary.indexOf('"readinessOutputCliIndexPositiveGuards": [');
    const readinessOutputCliIndexPositiveGuardNegativeScenariosIndex = readinessFixtureResult.summary.indexOf('"readinessOutputCliIndexPositiveGuardNegativeScenarios": [');
    const readinessOutputCliIndexNegativeScenariosIndex = readinessFixtureResult.summary.indexOf('"readinessOutputCliIndexNegativeScenarios": [');
    const readinessSummaryNegativeGuardsIndex = readinessFixtureResult.summary.indexOf('"readinessSummaryNegativeGuards": [');
    const compactReadinessNegativeGuardsIndex = readinessFixtureResult.summary.indexOf('"compactReadinessNegativeGuards": [');
    const failedCompactReadinessNegativeGuardsIndex = readinessFixtureResult.summary.indexOf('"failedCompactReadinessNegativeGuards": [');
    const failedCompactReadinessCliGuardsIndex = readinessFixtureResult.summary.indexOf('"failedCompactReadinessCliGuards": [');
    const firstBooleanFailureFieldIndex = readinessFixtureResult.summary.indexOf('"missingScannedFileCountFails": true');
    fixtureSummaryIndexes = {
      failureFlagsIndex,
      positiveFixtureGuardsIndex,
      negativeFixtureGuardsIndex,
      directHelperNegativeGuardsIndex,
      directHelperNegativeScenariosIndex,
      evaluationReportNegativeGuardsIndex,
      readinessOutputCliIndexPositiveGuardsIndex,
      readinessOutputCliIndexPositiveGuardNegativeScenariosIndex,
      readinessOutputCliIndexNegativeScenariosIndex,
      readinessSummaryNegativeGuardsIndex,
      compactReadinessNegativeGuardsIndex,
      failedCompactReadinessNegativeGuardsIndex,
      failedCompactReadinessCliGuardsIndex,
      firstBooleanFailureFieldIndex,
    };
    assertFixtureEvidenceOrder(fixtureSummaryIndexes);
    assertFixtureSummaryKeySchema(readinessFixtureOutput);
    fixtureSummaryKeyCount = assertFixtureSummaryKeyCount(readinessFixtureOutput);
  }

  const scannedFileCountMatch = textOutputResult.summary.match(/"scannedFileCount":\s*(\d+)/);
  assert.ok(scannedFileCountMatch, "text output scannedFileCount must be parseable");
  const scannedFileCount = Number(scannedFileCountMatch[1]);
  assert.ok(scannedFileCount > 0, "text output scannedFileCount must be positive");

  return { scannedFileCount, fixtureSummaryIndexes, fixtureSummaryKeyCount };
}

function runReadinessOutputCheck() {
  const result = spawnSync(process.execPath, ["scripts/verify-readiness-summary.mjs", "--compact"], {
    shell: false,
    encoding: "utf8",
    timeout: 180000,
  });

  const output = `${result.stdout || ""}${result.stderr || ""}`;
  assert.equal(result.status, 0, `compact readiness exited with ${result.status}\n${output}`);
  assertCompactReadinessOutput(output);

  const jsonResult = spawnSync(process.execPath, ["scripts/verify-readiness-summary.mjs"], {
    shell: false,
    encoding: "utf8",
    timeout: 180000,
  });
  const jsonOutput = `${jsonResult.stdout || ""}${jsonResult.stderr || ""}`;
  assert.equal(jsonResult.status, 0, `json readiness exited with ${jsonResult.status}\n${jsonOutput}`);

  const readinessSummary = JSON.parse(jsonOutput);
  const { scannedFileCount, fixtureSummaryIndexes, fixtureSummaryKeyCount } = assertReadinessJsonEvidence(readinessSummary, {
    requireFixtureSummary: true,
  });
  assertReadinessOutputCliIndexes(fixtureSummaryIndexes);

  console.log(JSON.stringify({
    ok: true,
    checked: "verify-readiness-summary --compact",
    requiredLines,
    latestEvaluationRound: expectedLatestEvaluationRound,
    checklistCommands: expectedChecklistCommands,
    checklistItems: expectedChecklistItems,
    textOutputScannedFileCount: scannedFileCount,
    fixtureSummaryKeyCount,
    fixtureSummaryIndexes,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runReadinessOutputCheck();
}
