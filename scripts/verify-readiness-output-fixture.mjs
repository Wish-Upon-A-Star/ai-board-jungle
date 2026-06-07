import assert from "node:assert/strict";
import { assertReadinessJsonEvidence } from "./verify-readiness-output.mjs";
import { expectedChecklistCommands, expectedChecklistItems } from "./verify-readme-contract.mjs";

function buildReadmeResult() {
  return {
    name: "readme",
    summary: [
      `  "checklistCommands": ${expectedChecklistCommands},`,
      `  "checklistItems": ${expectedChecklistItems}`,
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

function buildReadiness(textOutputOptions) {
  return {
    results: [
      buildReadmeResult(),
      buildTextOutputResult(textOutputOptions),
    ],
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

console.log(JSON.stringify({
  ok: true,
  checked: "verify-readiness-output negative fixture",
  validScannedFileCount: validResult.scannedFileCount,
  missingScannedFileCountFails: true,
  nonEmptyMissingRequiredFilesFails: true,
  missingRequiredScannedFilesFails: true,
}, null, 2));
