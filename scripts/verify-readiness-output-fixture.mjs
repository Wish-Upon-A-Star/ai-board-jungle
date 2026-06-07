import assert from "node:assert/strict";
import { assertReadinessJsonEvidence } from "./verify-readiness-output.mjs";
import { expectedChecklistCommands, expectedChecklistItems } from "./verify-readme-contract.mjs";

const validReadiness = {
  results: [
    {
      name: "readme",
      summary: [
        `  "checklistCommands": ${expectedChecklistCommands},`,
        `  "checklistItems": ${expectedChecklistItems}`,
      ].join("\n"),
    },
    {
      name: "text output",
      summary: [
        '  "checked": "verify-text output",',
        '  "requiredScannedFiles": [',
        '    "scripts/verify-readme-contract.mjs"',
        "  ],",
        '  "missingRequiredFiles": [],',
        '  "hits": [],',
        '  "scannedFileCount": 46',
      ].join("\n"),
    },
  ],
};

const missingScannedFileCount = {
  results: [
    validReadiness.results[0],
    {
      name: "text output",
      summary: [
        '  "checked": "verify-text output",',
        '  "requiredScannedFiles": [',
        '    "scripts/verify-readme-contract.mjs"',
        "  ],",
        '  "missingRequiredFiles": [],',
        '  "hits": []',
      ].join("\n"),
    },
  ],
};

const nonEmptyMissingRequiredFiles = {
  results: [
    validReadiness.results[0],
    {
      name: "text output",
      summary: [
        '  "checked": "verify-text output",',
        '  "requiredScannedFiles": [',
        '    "scripts/verify-readme-contract.mjs"',
        "  ],",
        '  "missingRequiredFiles": [',
        '    "scripts/verify-readme-contract.mjs"',
        "  ],",
        '  "hits": [],',
        '  "scannedFileCount": 46',
      ].join("\n"),
    },
  ],
};

const missingRequiredScannedFiles = {
  results: [
    validReadiness.results[0],
    {
      name: "text output",
      summary: [
        '  "checked": "verify-text output",',
        '  "missingRequiredFiles": [],',
        '  "hits": [],',
        '  "scannedFileCount": 46',
      ].join("\n"),
    },
  ],
};

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
