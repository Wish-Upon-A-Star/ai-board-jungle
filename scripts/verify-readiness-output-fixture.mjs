import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  assertCompactReadinessOutput,
  assertFailedCompactReadinessOutput,
  assertFixtureEvidenceOrder,
  assertFixtureSummaryIndexes,
  assertFixtureSummaryKeyCount,
  assertFixtureSummaryKeySchema,
  assertReadinessJsonEvidence,
  assertReadinessOutputCliIndexes,
  buildReadinessOutputCliSummary,
  expectedFixtureSummaryKeys,
} from "./verify-readiness-output.mjs";
import { serverRequiredCommands } from "./verification-command-lists.mjs";
import {
  formatCompactReadinessSummary,
  readinessNote,
} from "./verify-readiness-summary.mjs";
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

const fixtureSource = readFileSync(new URL(import.meta.url), "utf8");
const summaryCountNegativeScenarioSourceChecks = [
  {
    name: "missingFixtureSummaryKeyCount",
    pattern: /assert\.throws\([\s\S]*buildReadinessOutputCliSummary\(missingFixtureSummaryKeyCountArgs\)[\s\S]*without fixtureSummaryKeyCount must fail/,
  },
  {
    name: "nonIntegerFixtureSummaryKeyCount",
    pattern: /assert\.throws\([\s\S]*fixtureSummaryKeyCount: String\(expectedFixtureSummaryKeys\.length\)[\s\S]*non-integer fixtureSummaryKeyCount must fail/,
  },
  {
    name: "staleFixtureSummaryKeyCount",
    pattern: /assert\.throws\([\s\S]*fixtureSummaryKeyCount: expectedFixtureSummaryKeys\.length - 1[\s\S]*stale fixtureSummaryKeyCount must fail/,
  },
];
for (const scenario of summaryCountNegativeScenarioSourceChecks) {
  assert.ok(
    scenario.pattern.test(fixtureSource),
    `readiness output fixture source must retain ${scenario.name} summary count negative scenario`
  );
}

const negativeFixtureGuardNegativeScenarioSourceChecks = [
  {
    name: "wrongNameNegativeFixtureGuard",
    pattern: /const wrongNameNegativeFixtureGuardsOutput = \{[\s\S]*"missingBooleanFailureFields"[\s\S]*readiness fixture summary with wrong negative fixture guard name must fail/,
  },
];
for (const scenario of negativeFixtureGuardNegativeScenarioSourceChecks) {
  assert.ok(
    scenario.pattern.test(fixtureSource),
    `readiness output fixture source must retain ${scenario.name} negative fixture guard scenario`
  );
}

const expectedNegativeFixtureGuards = [
  "extraBooleanFailureField",
  "missingBooleanFailureField",
  "missingFixtureSummaryKeyCount",
  "nonIntegerFixtureSummaryKeyCount",
  "staleFixtureSummaryKeyCount",
];

const expectedNegativeFixtureGuardNegativeScenarios = [
  "missingSummaryCountSourceGuard",
  "wrongNameNegativeFixtureGuard",
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

const expectedReadinessImportNegativeGuards = [
  "importStdoutBytesNonZero",
  "importStderrBytesNonZero",
  "importDurationTooHigh",
  "importExportsStale",
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
  "syntheticFailedCompactCliDuration",
];

const expectedDirectCompactFormatterGuards = [
  "directCompactFormatterSuccess",
  "directCompactFormatterFailure",
  "directCompactFormatterTrailingNewline",
];

const expectedReadinessNote = "This readiness summary does not start FastAPI, Vite, or Chrome CDP. Run npm run verify:full:quick for end-to-end smoke.";

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

function buildReadmeOutputResult() {
  return {
    name: "readme output",
    summary: [
      "{",
      '  "ok": true,',
      '  "checked": "verify-readme output",',
      '  "readmeChecked": "README.md",',
      '  "checklistPath": "docs/submission-checklist.md",',
      '  "required": 44,',
      `  "commandMentions": ${expectedChecklistCommands},`,
      `  "commandExplanations": ${expectedChecklistCommands},`,
      `  "checklistCommands": ${expectedChecklistCommands},`,
      `  "checklistItems": ${expectedChecklistItems},`,
      '  "screenshotOk": true',
      "}",
    ].join("\n"),
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

function buildReadinessImportResult({
  durationMs = 101,
  stdoutBytes = 0,
  stderrBytes = 0,
  exportsChecked = [
    "readinessNote",
    "checks",
    "getReadinessChecks",
    "buildReadinessSummary",
    "formatCompactReadinessSummary",
    "runReadinessSummaryCli",
  ],
} = {}) {
  return {
    name: "readiness import fixture",
    summary: JSON.stringify({
      ok: true,
      checked: "verify-readiness-summary import fixture",
      exportsChecked,
      durationMs,
      stdoutBytes,
      stderrBytes,
    }, null, 2),
  };
}

function buildReadiness(textOutputOptions, {
  includeReadmeResult = true,
  includeReadmeOutputResult = true,
  includeReadinessImportResult = true,
  includeEvaluationReportsResult = true,
  includeServerRequired = true,
  includeNote = true,
  readmeOptions,
  readinessImportOptions,
  evaluationReportsOptions,
} = {}) {
  const results = [buildTextOutputResult(textOutputOptions)];

  if (includeReadmeResult) {
    results.unshift(buildReadmeResult(readmeOptions));
  }

  if (includeReadmeOutputResult) {
    results.push(buildReadmeOutputResult());
  }

  if (includeReadinessImportResult) {
    results.push(buildReadinessImportResult(readinessImportOptions));
  }

  if (includeEvaluationReportsResult) {
    results.push(buildEvaluationReportsResult(evaluationReportsOptions));
  }

  return {
    latestEvaluationRound: expectedLatestEvaluationRound,
    ...(includeServerRequired ? { serverRequired: serverRequiredCommands } : {}),
    ...(includeNote ? { note: expectedReadinessNote } : {}),
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

const missingServerRequiredCommands = buildReadiness(undefined, {
  includeServerRequired: false,
});

const missingReadinessNote = buildReadiness(undefined, {
  includeNote: false,
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

const importStdoutBytesNonZero = buildReadiness(undefined, {
  readinessImportOptions: { stdoutBytes: 1 },
});

const importStderrBytesNonZero = buildReadiness(undefined, {
  readinessImportOptions: { stderrBytes: 1 },
});

const importDurationTooHigh = buildReadiness(undefined, {
  readinessImportOptions: { durationMs: 2000 },
});

const importExportsStale = buildReadiness(undefined, {
  readinessImportOptions: {
    exportsChecked: [
      "readinessNote",
      "checks",
      "getReadinessChecks",
      "buildReadinessSummary",
      "runReadinessSummaryCli",
    ],
  },
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
  negativeFixtureGuardNegativeScenariosIndex: 30,
  directHelperNegativeGuardsIndex: 40,
  directHelperNegativeScenariosIndex: 50,
  evaluationReportNegativeGuardsIndex: 60,
  readinessOutputCliIndexPositiveGuardsIndex: 70,
  readinessOutputCliIndexPositiveGuardNegativeScenariosIndex: 80,
  readinessOutputCliIndexNegativeScenariosIndex: 90,
  readinessImportNegativeGuardsIndex: 100,
  readinessSummaryNegativeGuardsIndex: 110,
  compactReadinessNegativeGuardsIndex: 120,
  failedCompactReadinessNegativeGuardsIndex: 130,
  failedCompactReadinessCliGuardsIndex: 140,
  directCompactFormatterGuardsIndex: 150,
  firstBooleanFailureFieldIndex: 160,
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
    readinessOutputCliIndexPositiveGuardsIndex: validFixtureSummaryIndexes.evaluationReportNegativeGuardsIndex,
  }),
  /after evaluationReportNegativeGuardsIndex/,
  "stale CLI fixture positive index equal to evaluationReportNegativeGuardsIndex must fail"
);
assert.throws(
  () => assertReadinessOutputCliIndexes({
    ...validFixtureSummaryIndexes,
    readinessOutputCliIndexNegativeScenariosIndex: validFixtureSummaryIndexes.readinessOutputCliIndexPositiveGuardsIndex,
  }),
  /after readinessOutputCliIndexPositiveGuardNegativeScenariosIndex/,
  "stale CLI fixture negative scenarios index equal to positive guard index must fail"
);
assert.throws(
  () => assertReadinessOutputCliIndexes({
    ...validFixtureSummaryIndexes,
    readinessOutputCliIndexPositiveGuardNegativeScenariosIndex: validFixtureSummaryIndexes.readinessOutputCliIndexPositiveGuardsIndex,
  }),
  /after readinessOutputCliIndexPositiveGuardsIndex/,
  "stale CLI fixture positive guard scenario index equal to positive guard index must fail"
);
assert.throws(
  () => assertReadinessOutputCliIndexes({
    ...validFixtureSummaryIndexes,
    readinessOutputCliIndexNegativeScenariosIndex: validFixtureSummaryIndexes.firstBooleanFailureFieldIndex,
  }),
  /after readinessOutputCliIndexNegativeScenariosIndex/,
  "misplaced CLI fixture index equal to firstBooleanFailureFieldIndex must fail"
);
assert.throws(
  () => assertReadinessOutputCliIndexes({
    ...validFixtureSummaryIndexes,
    readinessSummaryNegativeGuardsIndex: validFixtureSummaryIndexes.readinessOutputCliIndexNegativeScenariosIndex,
  }),
  /after readinessImportNegativeGuardsIndex/,
  "stale readiness summary negative guard index equal to readinessOutputCliIndexNegativeScenariosIndex must fail"
);
assert.throws(
  () => assertReadinessOutputCliIndexes({
    ...validFixtureSummaryIndexes,
    readinessImportNegativeGuardsIndex: validFixtureSummaryIndexes.readinessOutputCliIndexNegativeScenariosIndex,
  }),
  /after readinessOutputCliIndexNegativeScenariosIndex/,
  "stale readiness import negative guard index equal to readinessOutputCliIndexNegativeScenariosIndex must fail"
);
assert.throws(
  () => assertReadinessOutputCliIndexes({
    ...validFixtureSummaryIndexes,
    compactReadinessNegativeGuardsIndex: validFixtureSummaryIndexes.readinessSummaryNegativeGuardsIndex,
  }),
  /after readinessSummaryNegativeGuardsIndex/,
  "stale compact readiness negative guard index equal to readinessSummaryNegativeGuardsIndex must fail"
);
assert.throws(
  () => assertReadinessOutputCliIndexes({
    ...validFixtureSummaryIndexes,
    failedCompactReadinessNegativeGuardsIndex: validFixtureSummaryIndexes.compactReadinessNegativeGuardsIndex,
  }),
  /after compactReadinessNegativeGuardsIndex/,
  "stale failed compact readiness negative guard index equal to compactReadinessNegativeGuardsIndex must fail"
);
assert.throws(
  () => assertReadinessOutputCliIndexes({
    ...validFixtureSummaryIndexes,
    failedCompactReadinessCliGuardsIndex: validFixtureSummaryIndexes.failedCompactReadinessNegativeGuardsIndex,
  }),
  /after failedCompactReadinessNegativeGuardsIndex/,
  "stale failed compact readiness CLI guard index equal to failedCompactReadinessNegativeGuardsIndex must fail"
);
assert.throws(
  () => assertReadinessOutputCliIndexes({
    ...validFixtureSummaryIndexes,
    directCompactFormatterGuardsIndex: validFixtureSummaryIndexes.failedCompactReadinessCliGuardsIndex,
  }),
  /after failedCompactReadinessCliGuardsIndex/,
  "stale direct compact formatter guard index equal to failedCompactReadinessCliGuardsIndex must fail"
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
  () => assertReadinessJsonEvidence(missingServerRequiredCommands),
  /server-required command list/,
  "missing serverRequired fixture must fail"
);

assert.throws(
  () => assertReadinessJsonEvidence(missingReadinessNote),
  /server-required warning note/,
  "missing readiness note fixture must fail"
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

assert.throws(
  () => assertReadinessJsonEvidence(importStdoutBytesNonZero),
  /stdout stayed empty/,
  "readiness import fixture with non-zero stdoutBytes must fail"
);

assert.throws(
  () => assertReadinessJsonEvidence(importStderrBytesNonZero),
  /stderr stayed empty/,
  "readiness import fixture with non-zero stderrBytes must fail"
);

assert.throws(
  () => assertReadinessJsonEvidence(importDurationTooHigh),
  /duration stayed below/,
  "readiness import fixture at or above duration guard must fail"
);

assert.throws(
  () => assertReadinessJsonEvidence(importExportsStale),
  /expected imported exports/,
  "readiness import fixture with stale export list must fail"
);

const output = {
  ok: true,
  checked: "verify-readiness-output negative fixture",
  validScannedFileCount: validResult.scannedFileCount,
  failureFlags: expectedFailureFlags,
  positiveFixtureGuards: expectedPositiveFixtureGuards,
  negativeFixtureGuards: expectedNegativeFixtureGuards,
  negativeFixtureGuardNegativeScenarios: expectedNegativeFixtureGuardNegativeScenarios,
  directHelperNegativeGuards: expectedDirectHelperNegativeGuards,
  directHelperNegativeScenarios: expectedDirectHelperNegativeScenarios,
  evaluationReportNegativeGuards: expectedEvaluationReportNegativeGuards,
  readinessOutputCliIndexPositiveGuards: expectedReadinessOutputCliIndexPositiveGuards,
  readinessOutputCliIndexPositiveGuardNegativeScenarios: expectedReadinessOutputCliIndexPositiveGuardNegativeScenarios,
  readinessOutputCliIndexNegativeScenarios: expectedReadinessOutputCliIndexNegativeScenarios,
  readinessImportNegativeGuards: expectedReadinessImportNegativeGuards,
  readinessSummaryNegativeGuards: expectedReadinessSummaryNegativeGuards,
  compactReadinessNegativeGuards: expectedCompactReadinessNegativeGuards,
  failedCompactReadinessNegativeGuards: expectedFailedCompactReadinessNegativeGuards,
  failedCompactReadinessCliGuards: expectedFailedCompactReadinessCliGuards,
  directCompactFormatterGuards: expectedDirectCompactFormatterGuards,
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
    serverRequired: serverRequiredCommands,
    note: expectedReadinessNote,
    results: [
      buildReadmeResult(),
      buildReadmeOutputResult(),
      buildTextOutputResult(),
      buildEvaluationReportsResult(),
      buildReadinessImportResult(),
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
  output.negativeFixtureGuardNegativeScenarios,
  expectedNegativeFixtureGuardNegativeScenarios,
  "fixture output must expose negative fixture guard negative scenario coverage"
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
  output.readinessOutputCliIndexPositiveGuards,
  expectedReadinessOutputCliIndexPositiveGuards,
  "fixture output must expose readiness CLI index positive guard coverage"
);
assert.deepEqual(
  output.readinessOutputCliIndexPositiveGuardNegativeScenarios,
  expectedReadinessOutputCliIndexPositiveGuardNegativeScenarios,
  "fixture output must expose readiness CLI index positive helper negative scenario coverage"
);
assert.deepEqual(
  output.readinessOutputCliIndexNegativeScenarios,
  expectedReadinessOutputCliIndexNegativeScenarios,
  "fixture output must expose readiness CLI index negative scenario coverage"
);
assert.deepEqual(
  output.readinessSummaryNegativeGuards,
  expectedReadinessSummaryNegativeGuards,
  "fixture output must expose readiness summary warning negative guard coverage"
);
assert.deepEqual(
  output.compactReadinessNegativeGuards,
  expectedCompactReadinessNegativeGuards,
  "fixture output must expose compact readiness output negative guard coverage"
);
assert.deepEqual(
  output.failedCompactReadinessNegativeGuards,
  expectedFailedCompactReadinessNegativeGuards,
  "fixture output must expose failed compact readiness output negative guard coverage"
);
assert.deepEqual(
  output.failedCompactReadinessCliGuards,
  expectedFailedCompactReadinessCliGuards,
  "fixture output must expose failed compact readiness CLI formatter guard coverage"
);
assert.deepEqual(
  output.directCompactFormatterGuards,
  expectedDirectCompactFormatterGuards,
  "fixture output must expose direct compact formatter unit guard coverage"
);

function buildCompactReadinessOutput({ omitTotal = false, omitLatestRound = false, omitServerRequired = false, omitPassLine = false, omitNote = false } = {}) {
  const headerParts = [
    omitTotal ? null : "READINESS OK 12/12 passed",
    omitLatestRound ? null : `latest-evaluation-round: ${expectedLatestEvaluationRound}`,
    omitServerRequired ? null : `server-required: ${serverRequiredCommands.join(", ")}`,
  ].filter(Boolean);
  const passLines = [
    "PASS hygiene 1ms",
    "PASS text 1ms",
    "PASS text output 1ms",
    "PASS frontend helpers 1ms",
    "PASS template presets 1ms",
    "PASS evaluation reports 1ms",
    "PASS readme 1ms",
    "PASS readme output 1ms",
    "PASS readiness import fixture 1ms",
    "PASS readiness output fixture 1ms",
    "PASS command scope 1ms",
    "PASS backend syntax 1ms",
  ];
  if (omitPassLine) {
    passLines.splice(passLines.indexOf("PASS readme output 1ms"), 1);
  }
  return [
    headerParts.join("; "),
    omitNote ? null : `NOTE ${expectedReadinessNote}`,
    ...passLines,
  ].filter(Boolean).join("\n");
}

function buildFormatterSummaryFixture({ failed = false } = {}) {
  const results = [
    "hygiene",
    "text",
    "text output",
    "frontend helpers",
    "template presets",
    "evaluation reports",
    "readme",
    "readme output",
    "readiness import fixture",
    "readiness output fixture",
    "command scope",
    "backend syntax",
  ].map((name) => ({
    name,
    ok: true,
    status: 0,
    durationMs: 1,
    summary: "",
  }));

  if (failed) {
    results[2] = {
      ...results[2],
      ok: false,
      status: 1,
      summary: "simulated compact failure summary",
    };
  }

  const failedResults = results.filter((item) => !item.ok);
  return {
    ok: failedResults.length === 0,
    checked: results.length,
    passed: results.length - failedResults.length,
    failed: failedResults.map((item) => item.name),
    latestEvaluationRound: expectedLatestEvaluationRound,
    serverRequired: serverRequiredCommands,
    note: readinessNote,
    results,
  };
}

assert.doesNotThrow(
  () => assertCompactReadinessOutput(buildCompactReadinessOutput()),
  "valid compact readiness fixture must satisfy compact output assertions"
);
const formattedCompactReadinessOutput = formatCompactReadinessSummary(buildFormatterSummaryFixture());
assert.doesNotThrow(
  () => assertCompactReadinessOutput(formattedCompactReadinessOutput),
  "compact readiness formatter export must produce the same valid compact output shape without spawning a child process"
);
assert.ok(
  formattedCompactReadinessOutput.endsWith("\n"),
  "compact readiness formatter export must keep a trailing newline for CLI parity"
);
assert.throws(
  () => assertCompactReadinessOutput(buildCompactReadinessOutput({ omitTotal: true })),
  /readiness total/,
  "compact readiness output without total must fail"
);
assert.throws(
  () => assertCompactReadinessOutput(buildCompactReadinessOutput({ omitLatestRound: true })),
  /latest evaluation report round/,
  "compact readiness output without latest round must fail"
);
assert.throws(
  () => assertCompactReadinessOutput(buildCompactReadinessOutput({ omitServerRequired: true })),
  /server-required checks/,
  "compact readiness output without server-required line must fail"
);
assert.throws(
  () => assertCompactReadinessOutput(buildCompactReadinessOutput({ omitPassLine: true })),
  /PASS readme output/,
  "compact readiness output without a PASS line must fail"
);
assert.throws(
  () => assertCompactReadinessOutput(buildCompactReadinessOutput({ omitNote: true })),
  /server-required warning note/,
  "compact readiness output without note must fail"
);

function buildFailedCompactReadinessOutput({
  omitStatus = false,
  omitFailLine = false,
  omitSummary = false,
} = {}) {
  return [
    omitStatus ? null : `READINESS FAILED 11/12 passed; latest-evaluation-round: ${expectedLatestEvaluationRound}; server-required: ${serverRequiredCommands.join(", ")}`,
    `NOTE ${expectedReadinessNote}`,
    "PASS hygiene 1ms",
    "PASS text 1ms",
    omitFailLine ? null : "FAIL text output 2ms",
    omitSummary ? null : "simulated compact failure summary",
  ].filter(Boolean).join("\n");
}

assert.doesNotThrow(
  () => assertFailedCompactReadinessOutput(buildFailedCompactReadinessOutput(), {
    failedCheckName: "text output",
    expectedSummary: "simulated compact failure summary",
  }),
  "valid failed compact readiness fixture must keep failed check summary assertions"
);
assert.doesNotThrow(
  () => assertFailedCompactReadinessOutput(formatCompactReadinessSummary(buildFormatterSummaryFixture({ failed: true })), {
    failedCheckName: "text output",
    expectedSummary: "simulated compact failure summary",
  }),
  "compact readiness formatter export must produce failed compact output with captured summaries without spawning a child process"
);
assert.throws(
  () => assertFailedCompactReadinessOutput(buildFailedCompactReadinessOutput({ omitStatus: true }), {
    failedCheckName: "text output",
    expectedSummary: "simulated compact failure summary",
  }),
  /failed readiness status/,
  "failed compact readiness output without failed status must fail"
);
assert.throws(
  () => assertFailedCompactReadinessOutput(buildFailedCompactReadinessOutput({ omitFailLine: true }), {
    failedCheckName: "text output",
    expectedSummary: "simulated compact failure summary",
  }),
  /FAIL text output/,
  "failed compact readiness output without FAIL line must fail"
);
assert.throws(
  () => assertFailedCompactReadinessOutput(buildFailedCompactReadinessOutput({ omitSummary: true }), {
    failedCheckName: "text output",
    expectedSummary: "simulated compact failure summary",
  }),
  /captured summary/,
  "failed compact readiness output without captured failure summary must fail"
);

function runSyntheticFailedCompactReadinessCli() {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, ["scripts/verify-readiness-summary.mjs", "--compact"], {
    shell: false,
    encoding: "utf8",
    env: {
      ...process.env,
      AI_BOARD_READINESS_FORCE_FAIL: "1",
    },
    timeout: 30000,
  });
  return {
    status: result.status,
    durationMs: Date.now() - startedAt,
    output: `${result.stdout || ""}${result.stderr || ""}`,
  };
}

function assertSyntheticFailedCompactReadinessCliPerformance(result, maxDurationMs = 30000) {
  assert.ok(
    result.durationMs < maxDurationMs,
    `synthetic failed compact readiness CLI must finish before ${maxDurationMs}ms; observed ${result.durationMs}ms`
  );
}

const syntheticFailedCompactReadinessCli = runSyntheticFailedCompactReadinessCli();
assertSyntheticFailedCompactReadinessCliPerformance(syntheticFailedCompactReadinessCli);
assert.throws(
  () => assertSyntheticFailedCompactReadinessCliPerformance({ durationMs: 30000 }, 30000),
  /finish before 30000ms/,
  "synthetic failed compact readiness CLI duration guard must fail with a targeted message"
);
assert.equal(
  syntheticFailedCompactReadinessCli.status,
  1,
  `synthetic failed compact readiness CLI must exit 1\n${syntheticFailedCompactReadinessCli.output}`
);
assertFailedCompactReadinessOutput(syntheticFailedCompactReadinessCli.output, {
  failedCheckName: "synthetic compact failure",
  expectedSummary: "synthetic injected compact failure summary",
});
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
  negativeFixtureGuardNegativeScenariosIndex: outputKeys.indexOf("negativeFixtureGuardNegativeScenarios"),
  directHelperNegativeGuardsIndex: outputKeys.indexOf("directHelperNegativeGuards"),
  directHelperNegativeScenariosIndex: outputKeys.indexOf("directHelperNegativeScenarios"),
  evaluationReportNegativeGuardsIndex: outputKeys.indexOf("evaluationReportNegativeGuards"),
  readinessOutputCliIndexPositiveGuardsIndex: outputKeys.indexOf("readinessOutputCliIndexPositiveGuards"),
  readinessOutputCliIndexPositiveGuardNegativeScenariosIndex: outputKeys.indexOf("readinessOutputCliIndexPositiveGuardNegativeScenarios"),
  readinessOutputCliIndexNegativeScenariosIndex: outputKeys.indexOf("readinessOutputCliIndexNegativeScenarios"),
  readinessImportNegativeGuardsIndex: outputKeys.indexOf("readinessImportNegativeGuards"),
  readinessSummaryNegativeGuardsIndex: outputKeys.indexOf("readinessSummaryNegativeGuards"),
  compactReadinessNegativeGuardsIndex: outputKeys.indexOf("compactReadinessNegativeGuards"),
  failedCompactReadinessNegativeGuardsIndex: outputKeys.indexOf("failedCompactReadinessNegativeGuards"),
  failedCompactReadinessCliGuardsIndex: outputKeys.indexOf("failedCompactReadinessCliGuards"),
  directCompactFormatterGuardsIndex: outputKeys.indexOf("directCompactFormatterGuards"),
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
const validReadinessOutputCliSummaryArgs = {
  scannedFileCount: validSummaryResult.scannedFileCount,
  importFixtureEvidence: {
    durationMs: 101,
    stdoutBytes: 0,
    stderrBytes: 0,
    exportsChecked: [
      "readinessNote",
      "checks",
      "getReadinessChecks",
      "buildReadinessSummary",
      "formatCompactReadinessSummary",
      "runReadinessSummaryCli",
    ],
  },
  fixtureSummaryKeyCount: validSummaryResult.fixtureSummaryKeyCount,
  fixtureSummaryIndexes: {
    failureFlagsIndex: 1,
    positiveFixtureGuardsIndex: 2,
    negativeFixtureGuardsIndex: 3,
    directHelperNegativeGuardsIndex: 4,
    directHelperNegativeScenariosIndex: 5,
    evaluationReportNegativeGuardsIndex: 6,
    readinessOutputCliIndexPositiveGuardsIndex: 7,
    readinessOutputCliIndexPositiveGuardNegativeScenariosIndex: 8,
    readinessOutputCliIndexNegativeScenariosIndex: 9,
    readinessImportNegativeGuardsIndex: 10,
    readinessSummaryNegativeGuardsIndex: 11,
    compactReadinessNegativeGuardsIndex: 12,
    failedCompactReadinessNegativeGuardsIndex: 13,
    failedCompactReadinessCliGuardsIndex: 14,
    directCompactFormatterGuardsIndex: 15,
    firstBooleanFailureFieldIndex: 16,
  },
};
const validReadinessOutputCliSummary = buildReadinessOutputCliSummary(validReadinessOutputCliSummaryArgs);
assert.equal(
  validReadinessOutputCliSummary.fixtureSummaryKeyCount,
  expectedFixtureSummaryKeys.length,
  "readiness output CLI summary must surface the exported fixture schema key count"
);
const { fixtureSummaryKeyCount: omittedFixtureSummaryKeyCount, ...missingFixtureSummaryKeyCountArgs } = validReadinessOutputCliSummaryArgs;
assert.throws(
  () => buildReadinessOutputCliSummary(missingFixtureSummaryKeyCountArgs),
  /fixtureSummaryKeyCount/,
  "readiness output CLI summary without fixtureSummaryKeyCount must fail"
);
assert.throws(
  () => buildReadinessOutputCliSummary({
    ...validReadinessOutputCliSummaryArgs,
    fixtureSummaryKeyCount: String(expectedFixtureSummaryKeys.length),
  }),
  /fixtureSummaryKeyCount/,
  "readiness output CLI summary with non-integer fixtureSummaryKeyCount must fail"
);
assert.throws(
  () => buildReadinessOutputCliSummary({
    ...validReadinessOutputCliSummaryArgs,
    fixtureSummaryKeyCount: expectedFixtureSummaryKeys.length - 1,
  }),
  /schema key count/,
  "readiness output CLI summary with stale fixtureSummaryKeyCount must fail"
);
const misplacedValidScannedFileCountOutput = {
  ok: output.ok,
  checked: output.checked,
  failureFlags: output.failureFlags,
  validScannedFileCount: output.validScannedFileCount,
  positiveFixtureGuards: output.positiveFixtureGuards,
  negativeFixtureGuards: output.negativeFixtureGuards,
  negativeFixtureGuardNegativeScenarios: output.negativeFixtureGuardNegativeScenarios,
  directHelperNegativeGuards: output.directHelperNegativeGuards,
  directHelperNegativeScenarios: output.directHelperNegativeScenarios,
  evaluationReportNegativeGuards: output.evaluationReportNegativeGuards,
  readinessOutputCliIndexPositiveGuards: output.readinessOutputCliIndexPositiveGuards,
  readinessOutputCliIndexPositiveGuardNegativeScenarios: output.readinessOutputCliIndexPositiveGuardNegativeScenarios,
  readinessOutputCliIndexNegativeScenarios: output.readinessOutputCliIndexNegativeScenarios,
  readinessImportNegativeGuards: output.readinessImportNegativeGuards,
  readinessSummaryNegativeGuards: output.readinessSummaryNegativeGuards,
  compactReadinessNegativeGuards: output.compactReadinessNegativeGuards,
  failedCompactReadinessNegativeGuards: output.failedCompactReadinessNegativeGuards,
  failedCompactReadinessCliGuards: output.failedCompactReadinessCliGuards,
  directCompactFormatterGuards: output.directCompactFormatterGuards,
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
const wrongNameFailureFlagsOutput = {
  ...output,
  failureFlags: [
    "missingScannedFileCountFails",
    "nonEmptyMissingRequiredFilesFails",
    "missingRequiredScannedFilesFails",
    "missingReadmeResultFails",
    "missingChecklistCommandsFails",
    "staleChecklistCommandsFails",
    "missingChecklistItemsFails",
    "staleChecklistItemFails",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(wrongNameFailureFlagsOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with wrong failureFlags name must fail"
);
const expandedFailureFlagsOutput = {
  ...output,
  failureFlags: [
    ...expectedFailureFlags,
    "unexpectedFailureFlagFails",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(expandedFailureFlagsOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with expanded failureFlags must fail"
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
const missingSummaryCountSourceGuardOutput = {
  ...output,
  negativeFixtureGuards: expectedNegativeFixtureGuards.filter(
    (guard) => guard !== "missingFixtureSummaryKeyCount"
  ),
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(missingSummaryCountSourceGuardOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary without a summary count source guard must fail expected-order validation"
);
const wrongNameNegativeFixtureGuardsOutput = {
  ...output,
  negativeFixtureGuards: [
    "extraBooleanFailureField",
    "missingBooleanFailureFields",
    "missingFixtureSummaryKeyCount",
    "nonIntegerFixtureSummaryKeyCount",
    "staleFixtureSummaryKeyCount",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(wrongNameNegativeFixtureGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /missing-field negative guard/,
  "readiness fixture summary with wrong negative fixture guard name must fail"
);
const expandedNegativeFixtureGuardsOutput = {
  ...output,
  negativeFixtureGuards: [
    ...expectedNegativeFixtureGuards,
    "unexpectedNegativeFixtureGuard",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(expandedNegativeFixtureGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with expanded negative fixture guards must fail"
);
const missingNegativeFixtureGuardNegativeScenariosOutput = { ...output };
delete missingNegativeFixtureGuardNegativeScenariosOutput.negativeFixtureGuardNegativeScenarios;
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(missingNegativeFixtureGuardNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /negativeFixtureGuardNegativeScenarios/,
  "readiness fixture summary without negativeFixtureGuardNegativeScenarios must fail"
);
const staleNegativeFixtureGuardNegativeScenariosOutput = {
  ...output,
  negativeFixtureGuardNegativeScenarios: [],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(staleNegativeFixtureGuardNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /missing summary count source guard scenario/,
  "readiness fixture summary without negative fixture guard negative scenario names must fail"
);
const partialNegativeFixtureGuardNegativeScenariosOutput = {
  ...output,
  negativeFixtureGuardNegativeScenarios: ["missingSummaryCountSourceGuard"],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(partialNegativeFixtureGuardNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /wrong-name negative fixture guard scenario/,
  "readiness fixture summary without wrong-name negative fixture guard scenario must fail"
);
const expandedNegativeFixtureGuardNegativeScenariosOutput = {
  ...output,
  negativeFixtureGuardNegativeScenarios: [
    ...expectedNegativeFixtureGuardNegativeScenarios,
    "unexpectedNegativeFixtureGuardNegativeScenario",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(expandedNegativeFixtureGuardNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with expanded negative fixture guard negative scenarios must fail"
);
const reorderedNegativeFixtureGuardNegativeScenariosOutput = {
  ...output,
  negativeFixtureGuardNegativeScenarios: [...expectedNegativeFixtureGuardNegativeScenarios].reverse(),
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(reorderedNegativeFixtureGuardNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with reordered negative fixture guard negative scenarios must fail"
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
const wrongNameDirectHelperNegativeScenariosOutput = {
  ...output,
  directHelperNegativeScenarios: [
    "missingDirectHelperNegativeGuards",
    "staleDirectHelperNegativeGuards",
    "partialDirectHelperNegativeGuards",
    "reversedDirectHelperNegativeGuards",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(wrongNameDirectHelperNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /reversed partial direct helper guard scenario/,
  "readiness fixture summary with wrong direct helper negative scenario name must fail"
);
const expandedDirectHelperNegativeScenariosOutput = {
  ...output,
  directHelperNegativeScenarios: [
    ...expectedDirectHelperNegativeScenarios,
    "unexpectedDirectHelperNegativeScenario",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(expandedDirectHelperNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with expanded direct helper negative scenarios must fail"
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
const wrongNameEvaluationReportNegativeGuardsOutput = {
  ...output,
  evaluationReportNegativeGuards: [
    "truncatedEvaluationReportRounds",
    "duplicatedEvaluationReportRounds",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(wrongNameEvaluationReportNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /duplicate evaluation report guard/,
  "readiness fixture summary with wrong evaluation report negative guard name must fail"
);
const expandedEvaluationReportNegativeGuardsOutput = {
  ...output,
  evaluationReportNegativeGuards: [
    ...expectedEvaluationReportNegativeGuards,
    "unexpectedEvaluationReportNegativeGuard",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(expandedEvaluationReportNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with expanded evaluation report negative guards must fail"
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
const missingReadinessOutputCliIndexPositiveGuardsOutput = { ...output };
delete missingReadinessOutputCliIndexPositiveGuardsOutput.readinessOutputCliIndexPositiveGuards;
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(missingReadinessOutputCliIndexPositiveGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /readinessOutputCliIndexPositiveGuards/,
  "readiness fixture summary without readinessOutputCliIndexPositiveGuards must fail"
);
const staleReadinessOutputCliIndexPositiveGuardsOutput = {
  ...output,
  readinessOutputCliIndexPositiveGuards: [],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(staleReadinessOutputCliIndexPositiveGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /valid readiness CLI index positive guard/,
  "readiness fixture summary without CLI index positive guard names must fail"
);
const wrongNameReadinessOutputCliIndexPositiveGuardsOutput = {
  ...output,
  readinessOutputCliIndexPositiveGuards: ["validReadinessOutputCliIndexPlacement"],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(wrongNameReadinessOutputCliIndexPositiveGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /valid readiness CLI index positive guard/,
  "readiness fixture summary with wrong CLI index positive guard name must fail"
);
const expandedReadinessOutputCliIndexPositiveGuardsOutput = {
  ...output,
  readinessOutputCliIndexPositiveGuards: [
    ...expectedReadinessOutputCliIndexPositiveGuards,
    "unexpectedReadinessOutputCliIndexPositiveGuard",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(expandedReadinessOutputCliIndexPositiveGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with expanded CLI index positive guards must fail"
);
const reorderedReadinessOutputCliIndexPositiveGuardsOutput = {
  ...output,
  readinessOutputCliIndexPositiveGuards: [
    "unexpectedReadinessOutputCliIndexPositiveGuard",
    ...expectedReadinessOutputCliIndexPositiveGuards,
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(reorderedReadinessOutputCliIndexPositiveGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with reordered CLI index positive guards must fail"
);
const missingReadinessOutputCliIndexPositiveGuardNegativeScenariosOutput = { ...output };
delete missingReadinessOutputCliIndexPositiveGuardNegativeScenariosOutput.readinessOutputCliIndexPositiveGuardNegativeScenarios;
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(missingReadinessOutputCliIndexPositiveGuardNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /readinessOutputCliIndexPositiveGuardNegativeScenarios/,
  "readiness fixture summary without readinessOutputCliIndexPositiveGuardNegativeScenarios must fail"
);
const staleReadinessOutputCliIndexPositiveGuardNegativeScenariosOutput = {
  ...output,
  readinessOutputCliIndexPositiveGuardNegativeScenarios: [],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(staleReadinessOutputCliIndexPositiveGuardNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /stale CLI positive guard index negative scenario/,
  "readiness fixture summary without CLI index positive guard negative scenario names must fail"
);
const partialReadinessOutputCliIndexPositiveGuardNegativeScenariosOutput = {
  ...output,
  readinessOutputCliIndexPositiveGuardNegativeScenarios: [
    "staleReadinessOutputCliIndexPositiveGuardsIndex",
    "staleReadinessOutputCliIndexNegativeScenariosIndex",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(partialReadinessOutputCliIndexPositiveGuardNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /misplaced CLI negative scenarios index negative scenario/,
  "readiness fixture summary without misplaced positive guard helper scenario must fail"
);
const wrongNameReadinessOutputCliIndexPositiveGuardNegativeScenariosOutput = {
  ...output,
  readinessOutputCliIndexPositiveGuardNegativeScenarios: [
    "staleReadinessOutputCliIndexPositiveGuardsIndex",
    "staleReadinessOutputCliIndexNegativeScenariosIndex",
    "misplacedReadinessOutputCliIndexScenariosIndex",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(wrongNameReadinessOutputCliIndexPositiveGuardNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /misplaced CLI negative scenarios index negative scenario/,
  "readiness fixture summary with wrong positive guard helper scenario name must fail"
);
const expandedReadinessOutputCliIndexPositiveGuardNegativeScenariosOutput = {
  ...output,
  readinessOutputCliIndexPositiveGuardNegativeScenarios: [
    ...expectedReadinessOutputCliIndexPositiveGuardNegativeScenarios,
    "unexpectedReadinessOutputCliIndexPositiveGuardNegativeScenario",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(expandedReadinessOutputCliIndexPositiveGuardNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with expanded positive guard helper scenarios must fail"
);
const reorderedReadinessOutputCliIndexPositiveGuardNegativeScenariosOutput = {
  ...output,
  readinessOutputCliIndexPositiveGuardNegativeScenarios: [
    ...expectedReadinessOutputCliIndexPositiveGuardNegativeScenarios,
  ].reverse(),
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(reorderedReadinessOutputCliIndexPositiveGuardNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with reordered positive guard helper scenarios must fail"
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
const wrongNameReadinessOutputCliIndexNegativeScenariosOutput = {
  ...output,
  readinessOutputCliIndexNegativeScenarios: [
    "staleEvaluationReportNegativeGuardsIndex",
    "misplacedEvaluationReportGuardsIndex",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(wrongNameReadinessOutputCliIndexNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /misplaced CLI index negative scenario/,
  "readiness fixture summary with wrong CLI index negative scenario name must fail"
);
const expandedReadinessOutputCliIndexNegativeScenariosOutput = {
  ...output,
  readinessOutputCliIndexNegativeScenarios: [
    ...expectedReadinessOutputCliIndexNegativeScenarios,
    "unexpectedReadinessOutputCliIndexNegativeScenario",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(expandedReadinessOutputCliIndexNegativeScenariosOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with expanded CLI index negative scenarios must fail"
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
const missingReadinessSummaryNegativeGuardsOutput = { ...output };
delete missingReadinessSummaryNegativeGuardsOutput.readinessSummaryNegativeGuards;
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(missingReadinessSummaryNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /readinessSummaryNegativeGuards/,
  "readiness fixture summary without readinessSummaryNegativeGuards must fail"
);
const staleReadinessSummaryNegativeGuardsOutput = {
  ...output,
  readinessSummaryNegativeGuards: [],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(staleReadinessSummaryNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /missing server-required commands guard/,
  "readiness fixture summary without readiness summary negative guard names must fail"
);
const partialReadinessSummaryNegativeGuardsOutput = {
  ...output,
  readinessSummaryNegativeGuards: [
    "missingServerRequiredCommands",
    "missingReadinessNote",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(partialReadinessSummaryNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /missing compact readiness note guard/,
  "readiness fixture summary without compact readiness note guard must fail"
);
const wrongNameReadinessSummaryNegativeGuardsOutput = {
  ...output,
  readinessSummaryNegativeGuards: [
    "missingServerRequiredCommands",
    "missingReadinessNote",
    "missingCompactReadinessWarning",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(wrongNameReadinessSummaryNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /missing compact readiness note guard/,
  "readiness fixture summary with wrong readiness summary negative guard name must fail"
);
const expandedReadinessSummaryNegativeGuardsOutput = {
  ...output,
  readinessSummaryNegativeGuards: [
    ...expectedReadinessSummaryNegativeGuards,
    "unexpectedReadinessSummaryNegativeGuard",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(expandedReadinessSummaryNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with expanded readiness summary negative guards must fail"
);
const reorderedReadinessSummaryNegativeGuardsOutput = {
  ...output,
  readinessSummaryNegativeGuards: [...expectedReadinessSummaryNegativeGuards].reverse(),
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(reorderedReadinessSummaryNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with reordered readiness summary negative guards must fail"
);
const missingCompactReadinessNegativeGuardsOutput = { ...output };
delete missingCompactReadinessNegativeGuardsOutput.compactReadinessNegativeGuards;
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(missingCompactReadinessNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /compactReadinessNegativeGuards/,
  "readiness fixture summary without compactReadinessNegativeGuards must fail"
);
const staleCompactReadinessNegativeGuardsOutput = {
  ...output,
  compactReadinessNegativeGuards: [],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(staleCompactReadinessNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /missing compact total guard/,
  "readiness fixture summary without compact readiness negative guard names must fail"
);
const partialCompactReadinessNegativeGuardsOutput = {
  ...output,
  compactReadinessNegativeGuards: [
    "missingCompactTotal",
    "missingCompactLatestRound",
    "missingCompactServerRequiredLine",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(partialCompactReadinessNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /missing compact PASS line guard/,
  "readiness fixture summary without compact PASS line guard must fail"
);
const wrongNameCompactReadinessNegativeGuardsOutput = {
  ...output,
  compactReadinessNegativeGuards: [
    "missingCompactTotal",
    "missingCompactLatestRound",
    "missingCompactServerRequiredLine",
    "missingCompactPassLines",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(wrongNameCompactReadinessNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /missing compact PASS line guard/,
  "readiness fixture summary with wrong compact readiness negative guard name must fail"
);
const expandedCompactReadinessNegativeGuardsOutput = {
  ...output,
  compactReadinessNegativeGuards: [
    ...expectedCompactReadinessNegativeGuards,
    "unexpectedCompactReadinessNegativeGuard",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(expandedCompactReadinessNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with expanded compact readiness negative guards must fail"
);
const reorderedCompactReadinessNegativeGuardsOutput = {
  ...output,
  compactReadinessNegativeGuards: [...expectedCompactReadinessNegativeGuards].reverse(),
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(reorderedCompactReadinessNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with reordered compact readiness negative guards must fail"
);
const missingFailedCompactReadinessNegativeGuardsOutput = { ...output };
delete missingFailedCompactReadinessNegativeGuardsOutput.failedCompactReadinessNegativeGuards;
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(missingFailedCompactReadinessNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /failedCompactReadinessNegativeGuards/,
  "readiness fixture summary without failedCompactReadinessNegativeGuards must fail"
);
const staleFailedCompactReadinessNegativeGuardsOutput = {
  ...output,
  failedCompactReadinessNegativeGuards: [],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(staleFailedCompactReadinessNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /missing failed compact status guard/,
  "readiness fixture summary without failed compact readiness negative guard names must fail"
);
const partialFailedCompactReadinessNegativeGuardsOutput = {
  ...output,
  failedCompactReadinessNegativeGuards: [
    "missingFailedCompactStatus",
    "missingFailedCompactLine",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(partialFailedCompactReadinessNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /missing failed compact summary guard/,
  "readiness fixture summary without failed compact summary guard must fail"
);
const wrongNameFailedCompactReadinessNegativeGuardsOutput = {
  ...output,
  failedCompactReadinessNegativeGuards: [
    "missingFailedCompactStatus",
    "missingFailedCompactLine",
    "missingFailedCompactSummaries",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(wrongNameFailedCompactReadinessNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /missing failed compact summary guard/,
  "readiness fixture summary with wrong failed compact readiness negative guard name must fail"
);
const expandedFailedCompactReadinessNegativeGuardsOutput = {
  ...output,
  failedCompactReadinessNegativeGuards: [
    ...expectedFailedCompactReadinessNegativeGuards,
    "unexpectedFailedCompactReadinessNegativeGuard",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(expandedFailedCompactReadinessNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with expanded failed compact readiness negative guards must fail"
);
const reorderedFailedCompactReadinessNegativeGuardsOutput = {
  ...output,
  failedCompactReadinessNegativeGuards: [...expectedFailedCompactReadinessNegativeGuards].reverse(),
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(reorderedFailedCompactReadinessNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with reordered failed compact readiness negative guards must fail"
);
const missingFailedCompactReadinessCliGuardsOutput = { ...output };
delete missingFailedCompactReadinessCliGuardsOutput.failedCompactReadinessCliGuards;
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(missingFailedCompactReadinessCliGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /failedCompactReadinessCliGuards/,
  "readiness fixture summary without failedCompactReadinessCliGuards must fail"
);
const staleFailedCompactReadinessCliGuardsOutput = {
  ...output,
  failedCompactReadinessCliGuards: [],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(staleFailedCompactReadinessCliGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /synthetic failed compact CLI exit guard/,
  "readiness fixture summary without failed compact CLI guard names must fail"
);
const partialFailedCompactReadinessCliGuardsOutput = {
  ...output,
  failedCompactReadinessCliGuards: [
    "syntheticFailedCompactCliExit",
    "syntheticFailedCompactCliStatus",
    "syntheticFailedCompactCliLine",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(partialFailedCompactReadinessCliGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /synthetic failed compact CLI summary guard/,
  "readiness fixture summary without failed compact CLI summary guard must fail"
);
const partialFailedCompactReadinessCliDurationGuardsOutput = {
  ...output,
  failedCompactReadinessCliGuards: [
    "syntheticFailedCompactCliExit",
    "syntheticFailedCompactCliStatus",
    "syntheticFailedCompactCliLine",
    "syntheticFailedCompactCliSummary",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(partialFailedCompactReadinessCliDurationGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /synthetic failed compact CLI duration guard/,
  "readiness fixture summary without failed compact CLI duration guard must fail"
);
const wrongNameFailedCompactReadinessCliGuardsOutput = {
  ...output,
  failedCompactReadinessCliGuards: [
    "syntheticFailedCompactCliExit",
    "syntheticFailedCompactCliStatus",
    "syntheticFailedCompactCliLine",
    "syntheticFailedCompactCliSummaries",
    "syntheticFailedCompactCliDuration",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(wrongNameFailedCompactReadinessCliGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /synthetic failed compact CLI summary guard/,
  "readiness fixture summary with wrong failed compact CLI guard name must fail"
);
const expandedFailedCompactReadinessCliGuardsOutput = {
  ...output,
  failedCompactReadinessCliGuards: [
    ...expectedFailedCompactReadinessCliGuards,
    "unexpectedFailedCompactReadinessCliGuard",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(expandedFailedCompactReadinessCliGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with expanded failed compact CLI guards must fail"
);
const reorderedFailedCompactReadinessCliGuardsOutput = {
  ...output,
  failedCompactReadinessCliGuards: [...expectedFailedCompactReadinessCliGuards].reverse(),
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(reorderedFailedCompactReadinessCliGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with reordered failed compact CLI guards must fail"
);
const missingDirectCompactFormatterGuardsOutput = { ...output };
delete missingDirectCompactFormatterGuardsOutput.directCompactFormatterGuards;
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(missingDirectCompactFormatterGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /directCompactFormatterGuards/,
  "readiness fixture summary without directCompactFormatterGuards must fail"
);
const staleDirectCompactFormatterGuardsOutput = {
  ...output,
  directCompactFormatterGuards: [],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(staleDirectCompactFormatterGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /direct compact formatter success guard/,
  "readiness fixture summary without direct compact formatter guard names must fail"
);
const partialDirectCompactFormatterGuardsOutput = {
  ...output,
  directCompactFormatterGuards: [
    "directCompactFormatterSuccess",
    "directCompactFormatterFailure",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(partialDirectCompactFormatterGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /direct compact formatter trailing newline guard/,
  "readiness fixture summary without direct compact formatter trailing newline guard must fail"
);
const wrongNameDirectCompactFormatterGuardsOutput = {
  ...output,
  directCompactFormatterGuards: [
    "directCompactFormatterSuccess",
    "directCompactFormatterFailures",
    "directCompactFormatterTrailingNewline",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(wrongNameDirectCompactFormatterGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /direct compact formatter failure guard/,
  "readiness fixture summary with wrong direct compact formatter guard name must fail"
);
const expandedDirectCompactFormatterGuardsOutput = {
  ...output,
  directCompactFormatterGuards: [
    ...expectedDirectCompactFormatterGuards,
    "unexpectedDirectCompactFormatterGuard",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(expandedDirectCompactFormatterGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with expanded direct compact formatter guards must fail"
);
const reorderedDirectCompactFormatterGuardsOutput = {
  ...output,
  directCompactFormatterGuards: [...expectedDirectCompactFormatterGuards].reverse(),
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(reorderedDirectCompactFormatterGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with reordered direct compact formatter guards must fail"
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
const wrongNameDirectHelperNegativeGuardsOutput = {
  ...output,
  directHelperNegativeGuards: [
    "missingEvidenceIndex",
    "stringEvidenceIndexes",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(wrongNameDirectHelperNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /string evidence index direct helper guard/,
  "readiness fixture summary with wrong direct helper negative guard name must fail"
);
const expandedDirectHelperNegativeGuardsOutput = {
  ...output,
  directHelperNegativeGuards: [
    ...expectedDirectHelperNegativeGuards,
    "unexpectedDirectHelperNegativeGuard",
  ],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(expandedDirectHelperNegativeGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /expected order/,
  "readiness fixture summary with expanded direct helper negative guards must fail"
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
const wrongNamePositiveFixtureGuardsOutput = {
  ...output,
  positiveFixtureGuards: ["validFixtureSummaryIndex"],
};
assert.throws(
  () => assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(wrongNamePositiveFixtureGuardsOutput), {
    requireFixtureSummary: true,
  }),
  /valid index-shape positive guard/,
  "readiness fixture summary with wrong positive fixture guard name must fail"
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
  negativeFixtureGuardNegativeScenarios: output.negativeFixtureGuardNegativeScenarios,
  directHelperNegativeGuards: output.directHelperNegativeGuards,
  directHelperNegativeScenarios: output.directHelperNegativeScenarios,
  positiveFixtureGuards: output.positiveFixtureGuards,
  evaluationReportNegativeGuards: output.evaluationReportNegativeGuards,
  readinessOutputCliIndexPositiveGuards: output.readinessOutputCliIndexPositiveGuards,
  readinessOutputCliIndexPositiveGuardNegativeScenarios: output.readinessOutputCliIndexPositiveGuardNegativeScenarios,
  readinessOutputCliIndexNegativeScenarios: output.readinessOutputCliIndexNegativeScenarios,
  readinessImportNegativeGuards: output.readinessImportNegativeGuards,
  readinessSummaryNegativeGuards: output.readinessSummaryNegativeGuards,
  compactReadinessNegativeGuards: output.compactReadinessNegativeGuards,
  failedCompactReadinessNegativeGuards: output.failedCompactReadinessNegativeGuards,
  failedCompactReadinessCliGuards: output.failedCompactReadinessCliGuards,
  directCompactFormatterGuards: output.directCompactFormatterGuards,
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
  negativeFixtureGuardNegativeScenarios: output.negativeFixtureGuardNegativeScenarios,
  directHelperNegativeGuards: output.directHelperNegativeGuards,
  directHelperNegativeScenarios: output.directHelperNegativeScenarios,
  evaluationReportNegativeGuards: output.evaluationReportNegativeGuards,
  readinessOutputCliIndexPositiveGuards: output.readinessOutputCliIndexPositiveGuards,
  readinessOutputCliIndexPositiveGuardNegativeScenarios: output.readinessOutputCliIndexPositiveGuardNegativeScenarios,
  readinessOutputCliIndexNegativeScenarios: output.readinessOutputCliIndexNegativeScenarios,
  readinessImportNegativeGuards: output.readinessImportNegativeGuards,
  readinessSummaryNegativeGuards: output.readinessSummaryNegativeGuards,
  compactReadinessNegativeGuards: output.compactReadinessNegativeGuards,
  failedCompactReadinessNegativeGuards: output.failedCompactReadinessNegativeGuards,
  failedCompactReadinessCliGuards: output.failedCompactReadinessCliGuards,
  directCompactFormatterGuards: output.directCompactFormatterGuards,
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
  negativeFixtureGuardNegativeScenarios: output.negativeFixtureGuardNegativeScenarios,
  directHelperNegativeGuards: output.directHelperNegativeGuards,
  directHelperNegativeScenarios: output.directHelperNegativeScenarios,
  evaluationReportNegativeGuards: output.evaluationReportNegativeGuards,
  readinessOutputCliIndexPositiveGuards: output.readinessOutputCliIndexPositiveGuards,
  readinessOutputCliIndexPositiveGuardNegativeScenarios: output.readinessOutputCliIndexPositiveGuardNegativeScenarios,
  readinessOutputCliIndexNegativeScenarios: output.readinessOutputCliIndexNegativeScenarios,
  readinessImportNegativeGuards: output.readinessImportNegativeGuards,
  readinessSummaryNegativeGuards: output.readinessSummaryNegativeGuards,
  compactReadinessNegativeGuards: output.compactReadinessNegativeGuards,
  failedCompactReadinessNegativeGuards: output.failedCompactReadinessNegativeGuards,
  failedCompactReadinessCliGuards: output.failedCompactReadinessCliGuards,
  directCompactFormatterGuards: output.directCompactFormatterGuards,
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
