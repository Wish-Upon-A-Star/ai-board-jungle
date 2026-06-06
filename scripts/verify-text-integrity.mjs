import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

const scanTargets = ["README.md", "backend", "frontend/src", "scripts", "docs/submission-checklist.md", "package.json"];
const ignoredParts = new Set(["node_modules", "dist", "__pycache__", ".pytest_cache", ".chrome-verify"]);
const ignoredFiles = new Set(["scripts/verify-text-integrity.mjs"]);
const suspiciousChars = [
  "\u5bc3",
  "\u8e42",
  "\uf9de",
  "\u6e90",
  "\u79fb",
  "\u5ac4",
  "\u91c9",
];
const suspiciousFragments = [
  "?\ub300",
  "?\uace7",
  "?\u3157",
  "?\uc4d2",
  "?\uc12f",
  "?\ub311",
  "?\uba50",
];

function runGit(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

function listLocalFiles(target) {
  if (!existsSync(target)) return [];
  if (statSync(target).isFile()) return [target];
  const files = [];
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (ignoredParts.has(entry.name)) continue;
    const path = `${target}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...listLocalFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function listFiles(target) {
  if (!existsSync(target)) return [];
  if (statSync(target).isFile()) return [target];
  const output = runGit(["ls-files", target]);
  if (output) return output.split(/\r?\n/).filter(Boolean);
  return listLocalFiles(target);
}

const hits = [];
const scannedFiles = [];

for (const target of scanTargets) {
  for (const file of listFiles(target)) {
    if (ignoredFiles.has(file) || !existsSync(file) || statSync(file).size > 750_000) continue;
    const content = readFileSync(file, "utf8");
    scannedFiles.push(file);
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      const matchedChar = suspiciousChars.find((char) => line.includes(char));
      const matchedFragment = suspiciousFragments.find((fragment) => line.includes(fragment));
      if (matchedChar || matchedFragment || line.includes("\uFFFD")) {
        hits.push({
          file,
          line: index + 1,
          marker: matchedChar || matchedFragment || "replacement-character",
          text: line.slice(0, 180),
        });
      }
    });
  }
}

if (hits.length) {
  console.error(JSON.stringify({ ok: false, checked: scannedFiles.length, hits }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, checked: scannedFiles.length, hits: [] }, null, 2));
