export const serverlessCommands = [
  "verify:hygiene",
  "verify:text",
  "verify:text-output",
  "verify:frontend-helpers",
  "verify:template-presets",
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
  "smoke:http",
  "smoke:ui",
  "verify:fastapi",
  "verify:full:quick",
  "verify:full",
  "test:live-integrations",
];

export const serverRequiredExclusivePorts = [3000, 8000];

export const serverRequiredConcurrencyNote =
  "Run server-required checks sequentially; verify:full:quick and verify:fastapi both own and clean ports 3000/8000.";
