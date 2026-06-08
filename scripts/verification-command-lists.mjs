export const serverlessCommands = [
  "verify:hygiene",
  "verify:text",
  "verify:text-output",
  "verify:frontend-helpers",
  "verify:template-presets",
  "verify:network-config",
  "verify:evaluation-reports",
  "verify:readiness",
  "verify:readiness:compact",
  "verify:readiness-output",
  "verify:readiness-output-fixture",
  "verify:command-scope",
  "verify:readme",
  "verify:readme-output",
];

export const serverRequiredCommands = [
  "verify:contract",
  "verify:postgres",
  "verify:production-serve",
  "verify:external-serve",
  "smoke:http",
  "smoke:ui",
  "verify:fastapi",
  "verify:full:quick",
  "verify:full",
  "test:live-integrations",
];

export const serverRequiredExclusivePorts = [8131, 8140, 8141, 8142, 3141, 3142];

export const serverRequiredConcurrencyNote =
  "Run server-required checks sequentially. verify:postgres uses port 8140, verify:fastapi uses ports 8141/3141, verify:full:quick uses ports 8142/3142, and verify:external-serve uses port 8131; these checks must not stop the current 3000/8000 server.";

export const safeLocalVerificationOrder = [
  "verify:readiness",
  "verify:command-scope",
  "verify:readme-output",
  "verify:postgres",
  "verify:fastapi",
  "verify:full:quick",
];
