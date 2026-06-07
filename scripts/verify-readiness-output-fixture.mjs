import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  assertFixtureEvidenceOrder,
  assertFixtureSummaryIndexes,
  assertFixtureSummaryKeyCount,
  assertFixtureSummaryKeySchema,
  assertReadinessJsonEvidence,
  assertReadinessOutputCliIndexes,
  expectedFixtureSummaryKeys,
} from "./verify-readiness-output.mjs";
import {
  buildEvaluationReportSummary,
  getLatestEvaluationRound,
  readEvaluationReportRounds,
} from "./verify-evaluation-reports.mjs";
import { expectedChecklistCommands, expectedChecklistItems } from "./verify-readme-contract.mjs";

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

const expectedNegativeFixtureGuards = [
  "extraBooleanFailureField",
  "missingBooleanFailureField",
];

const expectedDirectHelperNegativeGuards = [
  "missingEvidenceIndex",
  "stringEvidenceIndex",
];

const expectedDirectHelperNegativeScenarios = [
  "missingDirectHelperNegativeGuards",
  "staleDirectHelperNegativeGuards",
  "partialDirectHelperNegativeGuards",
  "reversedPartialDirectHelperNegativeGuards",
];

const expectedPositiveFixtureGuards = [
  "validFixtureSummaryIndexes",
];

const expectedEvaluationReportNegativeGuards = [
  "truncatedEvaluationReportRounds",
  "duplicateEvaluationReportRounds",
];

const expectedReadinessOutputCliIndexNegativeScenarios = [
  "staleEvaluationReportNegativeGuardsIndex",
  "misplacedEvaluationReportNegativeGuardsIndex",
];

const evaluationReportRounds = readEvaluationReportRounds();
const expectedEvaluationReportSummary = buildEvaluationReportSummary(evaluationReportRounds);
const expectedLatestEvaluationRound = getLatestEvaluationRound();
const truncatedEvaluationReportRounds = evaluationReportRounds.slice(1);
assert.throws(
  () => buildEvaluationReportSummary(truncatedEvaluationReportRounds),
  /expected round 01/,
  "buildEvaluationReportSummary must reject a truncated rounds array before CLI execution"
);
const duplicateEvaluationReportRounds = [
  ...evaluationReportRounds,
  evaluationReportRounds.at(-1),
];
assert.throws(
  () => buildEvaluationReportSummary(duplicateEvaluationReportRounds),
  /duplicate evaluation report round \d+/,
  "buildEvaluationReportSummary must reject duplicate rounds before CLI execution"
);

function readEvaluationReportsCliSummary() {
  const result = spawnSync(process.execPath, ["scripts/verify-evaluation-reports.mjs"], {
    shell: false,
    encoding: "utf8",
    timeout: 120000,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  assert.equal(result.status, 0, `verify-evaluation-reports CLI fixture exited with ${result.status}\n${output}`);
  return JSON.parse(output);
}

const evaluationReportsCliSummary = readEvaluationReportsCliSummary();

assert.deepEqual(
  evaluationReportsCliSummary,
  expectedEvaluationReportSummary,
  "verify:evaluation-reports CLI summary must match the shared evaluation report summary builder"
);
assert.equal(
  evaluationReportsCliSummary.ok,
  true,
  "verify:evaluation-reports CLI ok flag must stay true in parity fixture"
);
assert.equal(
  evaluationReportsCliSummary.latestRound,
  expectedLatestEvaluationRound,
  "getLatestEvaluationRound helper must match verify:evaluation-reports CLI latestRound"
);
assert.equal(
  evaluationReportsCliSummary.checked,
  expectedEvaluationReportSummary.checked,
  "readEvaluationReportRounds helper count must match verify:evaluation-reports CLI checked count"
);
assert.equal(
  evaluationReportsCliSummary.first,
  expectedEvaluationReportSummary.first,
  "readEvaluationReportRounds first file must match verify:evaluation-reports CLI first file"
);
assert.equal(
  evaluationReportsCliSummary.latest,
  expectedEvaluationReportSummary.latest,
  "readEvaluationReportRounds latest file must match verify:evaluation-reports CLI latest file"
);

function buildEvaluationReportsResult({ latestRound = expectedLatestEvaluationRound } = {}) {
  return {
    name: "evaluation reports",
    summary: JSON.stringify({
      ok: true,
      checked: latestRound,
      first: "2026-06-06-round-01.md",
      latest: `2026-06-07-round-${latestRound}.md`,
      latestRound,
    }, null, 2),
  };
}

function buildReadmeResult({
  includeChecklistCommands = true,
  includeChecklistItems = true,
  checklistCommands = expectedChecklistCommands,
  checklistItems = expectedChecklistItems,
} = {}) {
  const summary = [];

  if (includeChecklistCommands) {
    summary.push(`  "checklistCommands": ${checklistCommands},`);
  }

  if (includeChecklistItems) {
    summary.push(`  "checklistItems": ${checklistItems}`);
  }

  return {
    name: "readme",
    summary: summary.join("\n"),
  };
}

function buildTextOutputResult({
  includeRequiredScannedFiles = true,
  includeScannedFileCount = true,
  missingRequiredFiles = [],
} = {}) {
  const lines = ['  "checked": "verify-text output",'];

  if (includeRequiredScannedFiles) {
    lines.push(
      '  "requiredScannedFiles": [',
      '    "scripts/verify-readme-contract.mjs"',
      "  ],"
    );
  }

  if (missingRequiredFiles.length) {
    lines.push(
      '  "missingRequiredFiles": [',
      ...missingRequiredFiles.map((file) => `    "${file}"`),
      "  ],"
    );
  } else {
    lines.push('  "missingRequiredFiles": [],');
  }

  lines.push('  "hits": []');

  if (includeScannedFileCount) {
    lines[lines.length - 1] += ",";
    lines.push('  "scannedFileCount": 46');
  }

  return {
    name: "text output",
    summary: lines.join("\n"),
  };
}

function buildReadiness(textOutputOptions, {
  includeReadmeResult = true,
  includeEvaluationReportsResult = true,
  readmeOptions,
  evaluationReportsOptions,
} = {}) {
  const results = [buildTextOutputResult(textOutputOptions)];

  if (includeReadmeResult) {
    results.unshift(buildReadmeResult(readmeOptions));
  }

  if (includeEvaluationReportsResult) {
    results.push(buildEvaluationReportsResult(evaluationReportsOptions));
  }

  return {
    latestEvaluationRound: expectedLatestEvaluationRound,
    results,
  };
}

const validReadiness = buildReadiness();

const missingScannedFileCount = buildReadiness({
  includeScannedFileCount: false,
});

const nonEmptyMissingRequiredFiles = buildReadiness({
  missingRequiredFiles: ["scripts/verify-readme-contract.mjs"],
});

const missingRequiredScannedFiles = buildReadiness({
  includeRequiredScannedFiles: false,
});

const missingReadmeResult = buildReadiness(undefined, {
  includeReadmeResult: false,
});

const missingEvaluationReportsResult = buildReadiness(undefined, {
  includeEvaluationReportsResult: false,
});

const staleLatestEvaluationRound = buildReadiness(undefined, {
  evaluationReportsOptions: { latestRound: expectedLatestEvaluationRound - 1 },
});

const missingChecklistCommands = buildReadiness(undefined, {
  readmeOptions: { includeChecklistCommands: false },
});

const staleChecklistCommands = buildReadiness(undefined, {
  readmeOptions: { checklistCommands: expectedChecklistCommands - 1 },
});

const missingChecklistItems = buildReadiness(undefined, {
  readmeOptions: { includeChecklistItems: false },
});

const staleChecklistItems = buildReadiness(undefined, {
  readmeOptions: { checklistItems: expectedChecklistItems - 1 },
});

function assertFailureFlagFieldsMatch(output) {
  const booleanFailureFields = Object.keys(output).filter((key) => key.endsWith("Fails"));
  assert.deepEqual(
    booleanFailureFields.sort(),
    [...output.failureFlags].sort(),
    "fixture output failureFlags must match boolean *Fails fields"
  );
  assert.equal(
    output.failureFlags.length,
    booleanFailureFields.length,
    "fixture output failureFlags length must match boolean *Fails field count"
  );
}

const validResult = assertReadinessJsonEvidence(validReadiness);
assert.equal(validResult.scannedFileCount, 46, "valid fixture must parse scannedFileCount");
assert.equal(
  validResult.fixtureSummaryIndexes,
  null,
  "default fixture must not compute fixtureSummaryIndexes without requireFixtureSummary"
);
assert.equal(
  validResult.fixtureSummaryKeyCount,
  null,
  "default fixture must not compute fixtureSummaryKeyCount without requireFixtureSummary"
);
const validFixtureSummaryIndexes = {
  failureFlagsIndex: 0,
  positiveFixtureGuardsIndex: 10,
  negativeFixtureGuardsIndex: 20,
  directHelperNegativeGuardsIndex: 30,
  directHelperNegativeScenariosIndex: 40,
  evaluationReportNegativeGuardsIndex: 50,
  firstBooleanFailureFieldIndex: 60,
};
assertFixtureSummaryIndexes(validFixtureSummaryIndexes);
assertFixtureEvidenceOrder(validFixtureSummaryIndexes);
assertReadinessOutputCliIndexes(validFixtureSummaryIndexes);
assert.throws(
  () => assertFixtureEvidenceOrder({
    ...validFixtureSummaryIndexes,
    negativeFixtureGuardsIndex: validFixtureSummaryIndexes.positiveFixtureGuardsIndex,
  }),
  /failureFlags, positiveFixtureGuards, negativeFixtureGuards/,
  "equal adjacent evidence indexes must fail the strict order guard"
);
const missingEvidenceIndex = { ...validFixtureSummaryIndexes };
delete missingEvidenceIndex.firstBooleanFailureFieldIndex;
assert.throws(
  () => assertFixtureEvidenceOrder(missingEvidenceIndex),
  /non-negative integers/,
  "missing evidence index must fail the shared order guard shape check"
);
assert.throws(
  () => assertFixtureEvidenceOrder({ ...validFixtureSummaryIndexes, failureFlagsIndex: "0" }),
  /non-negative integers/,
  "string evidence index must fail the shared order guard shape check"
);
assert.throws(
  () => assertFixtureSummaryIndexes({ ...validFixtureSummaryIndexes, failureFlagsIndex: -1 }),
  /non-negative integers/,
  "mutated fixtureSummaryIndexes with -1 must fail the index-shape guard"
);
assert.throws(
  () => assertFixtureSummaryIndexes({ ...validFixtureSummaryIndexes, failureFlagsIndex: 1.5 }),
  /non-negative integers/,
  "mutated fixtureSummaryIndexes with a decimal must fail the index-shape guard"
);
assert.throws(
  () => assertFixtureSummaryIndexes({ ...validFixtureSummaryIndexes, failureFlagsIndex: "0" }),
  /non-negative integers/,
  "mutated fixtureSummaryIndexes with a string must fail the index-shape guard"
);
assert.throws(
  () => assertReadinessOutputCliIndexes({
    ...validFixtureSummaryIndexes,
    evaluationReportNegativeGuardsIndex: validFixtureSummaryIndexes.directHelperNegativeScenariosIndex,
  }),
  /after directHelperNegativeScenariosIndex/,
  "stale CLI fixture index equal to directHelperNegativeScenariosIndex must fail"
);
assert.throws(
  () => assertReadinessOutputCliIndexes({
    ...validFixtureSummaryIndexes,
    evaluationReportNegativeGuardsIndex: validFixtureSummaryIndexes.firstBooleanFailureFieldIndex,
  }),
  /after evaluationReportNegativeGuardsIndex/,
  "misplaced CLI fixture index equal to firstBooleanFailureFieldIndex must fail"
);

assert.throws(
  () => assertReadinessJsonEvidence(missingScannedFileCount),
  /scannedFileCount/,
  "missing scannedFileCount fixture must fail"
);

assert.throws(
  () => assertReadinessJsonEvidence(nonEmptyMissingRequiredFiles),
  /missingRequiredFiles/,
  "non-empty missingRequiredFiles fixture must fail"
);

assert.throws(
  () => assertReadinessJsonEvidence(missingRequiredScannedFiles),
  /requiredScannedFiles/,
  "missing requiredScannedFiles fixture must fail"
);

assert.throws(
  () => assertReadinessJsonEvidence(missingReadmeResult),
  /readme result/,
  "missing readme result fixture must fail"
);

assert.throws(
  () => assertReadinessJsonEvidence(missingEvaluationReportsResult),
  /evaluation reports result/,
  "missing evaluation reports result fixture must fail"
);

assert.throws(
  () => assertReadinessJsonEvidence(staleLatestEvaluationRound),
  /latest report round/,
  "stale latest evaluation round fixture must fail"
);

assert.throws(
  () => assertReadinessJsonEvidence(missingChecklistCommands),
  /checklistCommands/,
  "missing checklistCommands fixture must fail"
);

assert.throws(
  () => assertReadinessJsonEvidence(staleChecklistCommands),
  /checklistCommands/,
  "stale checklistCommands fixture must fail"
);

assert.throws(
  () => assertReadinessJsonEvidence(missingChecklistItems),
  /checklistItems/,
  "missing checklistItems fixture must fail"
);

assert.throws(
  () => assertReadinessJsonEvidence(staleChecklistItems),
  /checklistItems/,
  "stale checklistItems fixture must fail"
);

const output = {
  ok: true,
  checked: "verify-readiness-output negative fixture",
  validScannedFileCount: validResult.scannedFileCount,
  failureFlags: expectedFailureFlags,
  positiveFixtureGuards: expectedPositiveFixtureGuards,
  negativeFixtureGuards: expectedNegativeFixtureGuards,
  directHelperNegativeGuards: expectedDirectHelperNegativeGuards,
  directHelperNegativeScenarios: expectedDirectHelperNegativeScenarios,
  evaluationReportNegativeGuards: expectedEvaluationReportNegativeGuards,
  readinessOutputCliIndexNegativeScenarios: expectedReadinessOutputCliIndexNegativeScenarios,
  ...Object.fromEntries(expectedFailureFlags.map((flag) => [flag, true])),
};

function extraTopLevelFailureOutput() {
  return {
    ...output,
    unexpectedEvidence: "unexpected",
  };
}

function buildReadinessWithFixtureSummary(fixtureOutput) {
  return {
    latestEvaluationRound: expectedLatestEvaluationRound,
    results: [
      buildReadmeResult(),
      buildTextOutputResult(),
      buildEvaluationReportsResult(),
      {
        name: "readiness output fixture",
        summary: JSON.stringify(fixtureOutput, null, 2),
      },
    ],
  };
}

for (const flag of expectedFailureFlags) {
  assert.equal(output[flag], true, `fixture output must expose ${flag}`);
}

assertFailureFlagFieldsMatch(output);
assert.throws(
  () => assertFailureFlagFieldsMatch({ ...output, unexpectedFails: true }),
  /failureFlags/,
  "extra boolean *Fails fixture must fail the failureFlags guard"
);
const missingBooleanFailureOutput = { ...output };
delete missingBooleanFailureOutput.missingScannedFileCountFails;
assert.throws(
  () => assertFailureFlagFieldsMatch(missingBooleanFailureOutput),
  /failureFlags/,
  "missing boolean *Fails fixture must fail the failureFlags guard"
);
assert.deepEqual(
  output.positiveFixtureGuards,
  expectedPositiveFixtureGuards,
  "fixture output must expose covered positive guard directions"
);
assert.deepEqual(
  output.negativeFixtureGuards,
  expectedNegativeFixtureGuards,
  "fixture output must expose covered failureFlags guard directions"
);
assert.deepEqual(
  output.directHelperNegativeGuards,
  expectedDirectHelperNegativeGuards,
  "fixture output must expose direct helper negative guard directions"
);
assert.deepEqual(
  output.directHelperNegativeScenarios,
  expectedDirectHelperNegativeScenarios,
  "fixture output must expose direct helper negative scenario coverage"
);
assert.deepEqual(
  output.evaluationReportNegativeGuards,
  expectedEvaluationReportNegativeGuards,
  "fixture output must expose evaluation report builder negative guard coverage"
);
assert.deepEqual(
  output.readinessOutputCliIndexNegativeScenarios,
  expectedReadinessOutputCliIndexNegativeScenarios,
  "fixture output must expose readiness CLI index negative scenario coverage"
);
const outputKeys = Object.keys(output);
assert.deepEqual(
  expectedFixtureSummaryKeys,
  outputKeys,
  "exported fixture summary key schema must match fixture output keys"
);
assert.throws(
  () => expectedFixtureSummaryKeys.push("unexpectedEvidence"),
  /object is not extensible|Cannot add property|read only/,
  "exported fixture summary key schema must be read-only"
);
assertFixtureSummaryKeySchema(output);
assert.equal(
  assertFixtureSummaryKeyCount(output),
  expectedFixtureSummaryKeys.length,
  "direct fixture summary key count helper must report the exported schema length"
);
assert.throws(
  () => assertFixtureSummaryKeyCount(output, expectedFixtureSummaryKeys.length - 1),
  /key count/,
  "direct fixture summary key count helper must reject a shortened expected schema count"
);
assert.throws(
  () => assertFixtureSummaryKeySchema(extraTopLevelFailureOutput()),
  /top-level keys/,
  "direct fixture summary key schema helper must reject an extra top-level key"
);
assertFixtureEvidenceOrder({
  failureFlagsIndex: outputKeys.indexOf("failureFlags"),
  positiveFixtureGuardsIndex: outputKeys.indexOf("positiveFixtureGuards"),
  negativeFixtureGuardsIndex: outputKeys.indexOf("negativeFixtureGuards"),
  directHelperNegativeGuardsIndex: outputKeys.indexOf("directHelperNegativeGuards"),
  directHelperNegativeScenariosIndex: outputKeys.indexOf("directHelperNegativeScenarios"),
  evaluationReportNegativeGuardsIndex: outputKeys.indexOf("evaluationReportNegativeGuards"),
  firstBooleanFailureFieldIndex: outputKeys.findIndex((key) => key.endsWith("Fails")),
});

const validSummaryResult = assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(output), {
  requireFixtureSummary: true,
});
assert.equal(
  validSummaryResult.fixtureSummaryKeyCount,
  expectedFixtureSummaryKeys.length,
  "required fixture summary must report the exported schema key count"
);
const misplacedValidScannedFileCountOutput = {
  ok: output.ok,
  checked: output.checked,
  failureFlags: output.failureFlags,
  validScannedFileCount: output.validScannedFileCount,
  positiveFixtureGuards: output.positiveFixtureGuards,
  negativeFixtureGuards: output.negativeFixtureGuards,
  directHelperNegativeGuards: output.directHelperNegativeGuards,
  directHelperNegativeScenarios: output.directHelperNegativeScenarios,
  evaluationReportNegativeGuards: output.evaluationReportNegativeGuards,
  readinessOutputCliIndexNegativeScenarios: output.readinessOutputCliIndexNegativeScenarios,
  ...Object.fromEntries(expectedFailureFlags.map((flag) => [flag, true])),
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(misplacedValidScannedFileCountOutput), {
    requireFixtureSummary: true,
  }),
  /top-level keys/,
  "readiness fixture summary with validScannedFileCount after failureFlags must fail"
);
const extraTopLevelEvidenceOutput = {
  ...extraTopLevelFailureOutput(),
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(extraTopLevelEvidenceOutput), {
    requireFixtureSummary: true,
  }),
  /top-level keys/,
  "readiness fixture summary with an extra top-level evidence key must fail"
);
const reorderedFailureFlagsOutput = {
  ...output,
  failureFlags: [...expectedFailureFlags].reverse(),
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(reorderedFailureFlagsOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with reordered failureFlags must fail"
);
const reorderedNegativeFixtureGuardsOutput = {
  ...output,
  negativeFixtureGuards: [...expectedNegativeFixtureGuards].reverse(),
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(reorderedNegativeFixtureGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with reordered negative fixture guards must fail"
);
const missingDirectHelperNegativeScenariosOutput = { ...output };
delete missingDirectHelperNegativeScenariosOutput.directHelperNegativeScenarios;
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(missingDirectHelperNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /directHelperNegativeScenarios/,
  "readiness fixture summary without directHelperNegativeScenarios must fail"
);
const staleDirectHelperNegativeScenariosOutput = {
  ...output,
  directHelperNegativeScenarios: [],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(staleDirectHelperNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /missing direct helper guard scenario/,
  "readiness fixture summary without direct helper negative scenario names must fail"
);
const partialDirectHelperNegativeScenariosOutput = {
  ...output,
  directHelperNegativeScenarios: ["missingDirectHelperNegativeGuards"],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(partialDirectHelperNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /stale direct helper guard scenario/,
  "readiness fixture summary without stale direct helper negative scenario must fail"
);
const reversedPartialDirectHelperNegativeScenariosOutput = {
  ...output,
  directHelperNegativeScenarios: ["staleDirectHelperNegativeGuards"],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(reversedPartialDirectHelperNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /missing direct helper guard scenario/,
  "readiness fixture summary without missing direct helper negative scenario must fail"
);
const reorderedDirectHelperNegativeScenariosOutput = {
  ...output,
  directHelperNegativeScenarios: [...expectedDirectHelperNegativeScenarios].reverse(),
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(reorderedDirectHelperNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with reordered direct helper negative scenarios must fail"
);
const missingEvaluationReportNegativeGuardsOutput = { ...output };
delete missingEvaluationReportNegativeGuardsOutput.evaluationReportNegativeGuards;
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(missingEvaluationReportNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /evaluationReportNegativeGuards/,
  "readiness fixture summary without evaluationReportNegativeGuards must fail"
);
const staleEvaluationReportNegativeGuardsOutput = {
  ...output,
  evaluationReportNegativeGuards: [],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(staleEvaluationReportNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /truncated evaluation report guard/,
  "readiness fixture summary without evaluation report negative guard names must fail"
);
const partialEvaluationReportNegativeGuardsOutput = {
  ...output,
  evaluationReportNegativeGuards: ["truncatedEvaluationReportRounds"],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(partialEvaluationReportNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /duplicate evaluation report guard/,
  "readiness fixture summary without duplicate evaluation report guard must fail"
);
const reversedPartialEvaluationReportNegativeGuardsOutput = {
  ...output,
  evaluationReportNegativeGuards: ["duplicateEvaluationReportRounds"],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(reversedPartialEvaluationReportNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /truncated evaluation report guard/,
  "readiness fixture summary without truncated evaluation report guard must fail"
);
const reorderedEvaluationReportNegativeGuardsOutput = {
  ...output,
  evaluationReportNegativeGuards: [...expectedEvaluationReportNegativeGuards].reverse(),
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(reorderedEvaluationReportNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with reordered evaluation report negative guards must fail"
);
const missingReadinessOutputCliIndexNegativeScenariosOutput = { ...output };
delete missingReadinessOutputCliIndexNegativeScenariosOutput.readinessOutputCliIndexNegativeScenarios;
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(missingReadinessOutputCliIndexNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /readinessOutputCliIndexNegativeScenarios/,
  "readiness fixture summary without readinessOutputCliIndexNegativeScenarios must fail"
);
const staleReadinessOutputCliIndexNegativeScenariosOutput = {
  ...output,
  readinessOutputCliIndexNegativeScenarios: [],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(staleReadinessOutputCliIndexNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /stale CLI index negative scenario/,
  "readiness fixture summary without CLI index negative scenario names must fail"
);
const partialReadinessOutputCliIndexNegativeScenariosOutput = {
  ...output,
  readinessOutputCliIndexNegativeScenarios: ["staleEvaluationReportNegativeGuardsIndex"],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(partialReadinessOutputCliIndexNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /misplaced CLI index negative scenario/,
  "readiness fixture summary without misplaced CLI index negative scenario must fail"
);
const reversedPartialReadinessOutputCliIndexNegativeScenariosOutput = {
  ...output,
  readinessOutputCliIndexNegativeScenarios: ["misplacedEvaluationReportNegativeGuardsIndex"],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(reversedPartialReadinessOutputCliIndexNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /stale CLI index negative scenario/,
  "readiness fixture summary without stale CLI index negative scenario must fail"
);
const reorderedReadinessOutputCliIndexNegativeScenariosOutput = {
  ...output,
  readinessOutputCliIndexNegativeScenarios: [...expectedReadinessOutputCliIndexNegativeScenarios].reverse(),
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(reorderedReadinessOutputCliIndexNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with reordered CLI index negative scenarios must fail"
);
const missingDirectHelperNegativeGuardsOutput = { ...output };
delete missingDirectHelperNegativeGuardsOutput.directHelperNegativeGuards;
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(missingDirectHelperNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /directHelperNegativeGuards/,
  "readiness fixture summary without directHelperNegativeGuards must fail"
);
const staleDirectHelperNegativeGuardsOutput = {
  ...output,
  directHelperNegativeGuards: [],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(staleDirectHelperNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /missing evidence index direct helper guard/,
  "readiness fixture summary without direct helper guard names must fail"
);
const partialDirectHelperNegativeGuardsOutput = {
  ...output,
  directHelperNegativeGuards: ["missingEvidenceIndex"],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(partialDirectHelperNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /string evidence index direct helper guard/,
  "readiness fixture summary without string evidence direct helper guard must fail"
);
const reversedPartialDirectHelperNegativeGuardsOutput = {
  ...output,
  directHelperNegativeGuards: ["stringEvidenceIndex"],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(reversedPartialDirectHelperNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /missing evidence index direct helper guard/,
  "readiness fixture summary without missing evidence direct helper guard must fail"
);
const reorderedDirectHelperNegativeGuardsOutput = {
  ...output,
  directHelperNegativeGuards: [...expectedDirectHelperNegativeGuards].reverse(),
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(reorderedDirectHelperNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with reordered direct helper negative guards must fail"
);
const missingPositiveFixtureGuardsOutput = { ...output };
delete missingPositiveFixtureGuardsOutput.positiveFixtureGuards;
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(missingPositiveFixtureGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /positiveFixtureGuards/,
  "readiness fixture summary without positiveFixtureGuards must fail"
);
const stalePositiveFixtureGuardsOutput = {
  ...output,
  positiveFixtureGuards: [],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(stalePositiveFixtureGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /valid index-shape positive guard/,
  "readiness fixture summary without validFixtureSummaryIndexes positive guard must fail"
);
const expandedPositiveFixtureGuardsOutput = {
  ...output,
  positiveFixtureGuards: [...expectedPositiveFixtureGuards, "unexpectedPositiveGuard"],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(expandedPositiveFixtureGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with expanded positive fixture guards must fail"
);
const misplacedPositiveFixtureGuardsOutput = {
  ok: output.ok,
  checked: output.checked,
  validScannedFileCount: output.validScannedFileCount,
  failureFlags: output.failureFlags,
  negativeFixtureGuards: output.negativeFixtureGuards,
  directHelperNegativeGuards: output.directHelperNegativeGuards,
  directHelperNegativeScenarios: output.directHelperNegativeScenarios,
  positiveFixtureGuards: output.positiveFixtureGuards,
  evaluationReportNegativeGuards: output.evaluationReportNegativeGuards,
  readinessOutputCliIndexNegativeScenarios: output.readinessOutputCliIndexNegativeScenarios,
  ...Object.fromEntries(expectedFailureFlags.map((flag) => [flag, true])),
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(misplacedPositiveFixtureGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /failureFlags, positiveFixtureGuards, negativeFixtureGuards/,
  "readiness fixture summary with positiveFixtureGuards after negativeFixtureGuards must fail"
);
const earlyBooleanFailureFieldsOutput = {
  ok: output.ok,
  checked: output.checked,
  validScannedFileCount: output.validScannedFileCount,
  failureFlags: output.failureFlags,
  ...Object.fromEntries(expectedFailureFlags.map((flag) => [flag, true])),
  positiveFixtureGuards: output.positiveFixtureGuards,
  negativeFixtureGuards: output.negativeFixtureGuards,
  directHelperNegativeGuards: output.directHelperNegativeGuards,
  directHelperNegativeScenarios: output.directHelperNegativeScenarios,
  evaluationReportNegativeGuards: output.evaluationReportNegativeGuards,
  readinessOutputCliIndexNegativeScenarios: output.readinessOutputCliIndexNegativeScenarios,
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(earlyBooleanFailureFieldsOutput), {
    requireFixtureSummary: true,
  }),
  /then boolean \*Fails fields/,
  "readiness fixture summary with boolean *Fails before guard evidence must fail"
);
const misplacedFailureFlagsOutput = {
  ok: output.ok,
  checked: output.checked,
  validScannedFileCount: output.validScannedFileCount,
  positiveFixtureGuards: output.positiveFixtureGuards,
  failureFlags: output.failureFlags,
  negativeFixtureGuards: output.negativeFixtureGuards,
  directHelperNegativeGuards: output.directHelperNegativeGuards,
  directHelperNegativeScenarios: output.directHelperNegativeScenarios,
  evaluationReportNegativeGuards: output.evaluationReportNegativeGuards,
  readinessOutputCliIndexNegativeScenarios: output.readinessOutputCliIndexNegativeScenarios,
  ...Object.fromEntries(expectedFailureFlags.map((flag) => [flag, true])),
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(misplacedFailureFlagsOutput), {
    requireFixtureSummary: true,
  }),
  /failureFlags, positiveFixtureGuards, negativeFixtureGuards/,
  "readiness fixture summary with failureFlags after positiveFixtureGuards must fail"
);

console.log(JSON.stringify(output, null, 2));
