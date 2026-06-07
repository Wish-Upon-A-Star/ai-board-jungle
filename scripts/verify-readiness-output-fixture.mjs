import assert from "node:assert/strict";
import { assertFixtureEvidenceOrder, assertFixtureSummaryIndexes, assertReadinessJsonEvidence } from "./verify-readiness-output.mjs";
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

function buildReadiness(textOutputOptions, { includeReadmeResult = true, readmeOptions } = {}) {
  const results = [buildTextOutputResult(textOutputOptions)];

  if (includeReadmeResult) {
    results.unshift(buildReadmeResult(readmeOptions));
  }

  return {
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
const validFixtureSummaryIndexes = {
  failureFlagsIndex: 0,
  positiveFixtureGuardsIndex: 10,
  negativeFixtureGuardsIndex: 20,
  directHelperNegativeGuardsIndex: 30,
  directHelperNegativeScenariosIndex: 40,
  firstBooleanFailureFieldIndex: 50,
};
assertFixtureSummaryIndexes(validFixtureSummaryIndexes);
assertFixtureEvidenceOrder(validFixtureSummaryIndexes);
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
  ...Object.fromEntries(expectedFailureFlags.map((flag) => [flag, true])),
};

function buildReadinessWithFixtureSummary(fixtureOutput) {
  return {
    results: [
      buildReadmeResult(),
      buildTextOutputResult(),
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
const outputKeys = Object.keys(output);
assertFixtureEvidenceOrder({
  failureFlagsIndex: outputKeys.indexOf("failureFlags"),
  positiveFixtureGuardsIndex: outputKeys.indexOf("positiveFixtureGuards"),
  negativeFixtureGuardsIndex: outputKeys.indexOf("negativeFixtureGuards"),
  directHelperNegativeGuardsIndex: outputKeys.indexOf("directHelperNegativeGuards"),
  directHelperNegativeScenariosIndex: outputKeys.indexOf("directHelperNegativeScenarios"),
  firstBooleanFailureFieldIndex: outputKeys.findIndex((key) => key.endsWith("Fails")),
});

assertReadinessJsonEvidence(buildReadinessWithFixtureSummary(output), {
  requireFixtureSummary: true,
});
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
