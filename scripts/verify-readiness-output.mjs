import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { serverRequiredCommands } from "./verification-command-lists.mjs";
import { expectedChecklistCommands, expectedChecklistItems } from "./verify-readme-contract.mjs";

const expectedServerRequiredLine = `server-required: ${serverRequiredCommands.join(", ")}`;
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

const expectedDirectHelperNegativeScenarios = [
  "missingDirectHelperNegativeGuards",
  "staleDirectHelperNegativeGuards",
  "partialDirectHelperNegativeGuards",
  "reversedPartialDirectHelperNegativeGuards",
];

export function assertCompactReadinessOutput(output) {
  assert.ok(output.includes("READINESS OK 11/11 passed"), "compact output must include the readiness total");
  assert.ok(output.includes(expectedServerRequiredLine), "compact output must list server-required checks");

  for (const line of requiredLines) {
    assert.ok(output.includes(line), `compact output missing ${line}`);
  }
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
  firstBooleanFailureFieldIndex,
}) {
  assertFixtureSummaryIndexes({
    failureFlagsIndex,
    positiveFixtureGuardsIndex,
    negativeFixtureGuardsIndex,
    directHelperNegativeGuardsIndex,
    directHelperNegativeScenariosIndex,
    firstBooleanFailureFieldIndex,
  });
  assert.ok(
    failureFlagsIndex >= 0
      && positiveFixtureGuardsIndex > failureFlagsIndex
      && negativeFixtureGuardsIndex > positiveFixtureGuardsIndex
      && directHelperNegativeGuardsIndex > negativeFixtureGuardsIndex
      && directHelperNegativeScenariosIndex > directHelperNegativeGuardsIndex
      && firstBooleanFailureFieldIndex > directHelperNegativeScenariosIndex,
    "readiness output fixture summary must list failureFlags, positiveFixtureGuards, negativeFixtureGuards, directHelperNegativeGuards, directHelperNegativeScenarios, then boolean *Fails fields"
  );
}

export function assertReadinessJsonEvidence(readinessSummary, { requireFixtureSummary = false } = {}) {
  let fixtureSummaryIndexes = null;
  let readinessFixtureOutput = null;
  const readmeResult = readinessSummary.results.find((item) => item.name === "readme");
  assert.ok(readmeResult, "json readiness must include readme result");
  const textOutputResult = readinessSummary.results.find((item) => item.name === "text output");
  assert.ok(textOutputResult, "json readiness must include text output result");
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
      readinessFixtureResult.summary.includes('"positiveFixtureGuards": ['),
      "readiness output fixture summary must include positiveFixtureGuards list"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"validFixtureSummaryIndexes"'),
      "readiness output fixture summary must include valid index-shape positive guard"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"extraBooleanFailureField"'),
      "readiness output fixture summary must include extra-field negative guard"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"missingBooleanFailureField"'),
      "readiness output fixture summary must include missing-field negative guard"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"missingEvidenceIndex"'),
      "readiness output fixture summary must include missing evidence index direct helper guard"
    );
    assert.ok(
      readinessFixtureResult.summary.includes('"stringEvidenceIndex"'),
      "readiness output fixture summary must include string evidence index direct helper guard"
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
    const failureFlagsIndex = readinessFixtureResult.summary.indexOf('"failureFlags": [');
    const positiveFixtureGuardsIndex = readinessFixtureResult.summary.indexOf('"positiveFixtureGuards": [');
    const negativeFixtureGuardsIndex = readinessFixtureResult.summary.indexOf('"negativeFixtureGuards": [');
    const directHelperNegativeGuardsIndex = readinessFixtureResult.summary.indexOf('"directHelperNegativeGuards": [');
    const directHelperNegativeScenariosIndex = readinessFixtureResult.summary.indexOf('"directHelperNegativeScenarios": [');
    const firstBooleanFailureFieldIndex = readinessFixtureResult.summary.indexOf('"missingScannedFileCountFails": true');
    fixtureSummaryIndexes = {
      failureFlagsIndex,
      positiveFixtureGuardsIndex,
      negativeFixtureGuardsIndex,
      directHelperNegativeGuardsIndex,
      directHelperNegativeScenariosIndex,
      firstBooleanFailureFieldIndex,
    };
    assertFixtureEvidenceOrder(fixtureSummaryIndexes);
  }

  const scannedFileCountMatch = textOutputResult.summary.match(/"scannedFileCount":\s*(\d+)/);
  assert.ok(scannedFileCountMatch, "text output scannedFileCount must be parseable");
  const scannedFileCount = Number(scannedFileCountMatch[1]);
  assert.ok(scannedFileCount > 0, "text output scannedFileCount must be positive");

  return { scannedFileCount, fixtureSummaryIndexes };
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
  const { scannedFileCount, fixtureSummaryIndexes } = assertReadinessJsonEvidence(readinessSummary, {
    requireFixtureSummary: true,
  });

  console.log(JSON.stringify({
    ok: true,
    checked: "verify-readiness-summary --compact",
    requiredLines,
    checklistCommands: expectedChecklistCommands,
    checklistItems: expectedChecklistItems,
    textOutputScannedFileCount: scannedFileCount,
    fixtureSummaryIndexes,
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runReadinessOutputCheck();
}
