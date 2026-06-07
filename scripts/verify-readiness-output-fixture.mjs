import assert from "node:assert/strict";
import { assertReadinessJsonEvidence } from "./verify-readiness-output.mjs";
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
  negativeFixtureGuards: expectedNegativeFixtureGuards,
  ...Object.fromEntries(expectedFailureFlags.map((flag) => [flag, true])),
};

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
  output.negativeFixtureGuards,
  expectedNegativeFixtureGuards,
  "fixture output must expose covered failureFlags guard directions"
);

console.log(JSON.stringify(output, null, 2));
