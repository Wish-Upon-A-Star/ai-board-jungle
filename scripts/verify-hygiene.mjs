import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

const requiredIgnores = [
  "node_modules/",
  "frontend/node_modules/",
  "frontend/dist/",
  "data/",
  "*.db",
  "*.log",
  ".env",
];

const forbiddenTrackedPrefixes = [
  "node_modules/",
  "frontend/node_modules/",
  "frontend/dist/",
  "dist/",
  "data/",
  ".chrome-verify/",
];

const scanTargets = [
  "README.md",
  ".env.example",
  "backend",
  "frontend/src",
  "scripts",
  "docs",
  "package.json",
];

const tokenPatterns = [
  { name: "GitHub token", pattern: /gh[pousr]_[A-Za-z0-9_]{20,}/g },
  { name: "OpenAI key", pattern: /sk-[A-Za-z0-9]{20,}/g },
  { name: "Notion secret", pattern: /secret_[A-Za-z0-9]{20,}/g },
  { name: "Google OAuth token", pattern: /ya29\.[A-Za-z0-9_-]{20,}/g },
  { name: "Figma token", pattern: /figd_[A-Za-z0-9_-]{20,}/g },
];

function runGit(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

function listFiles(target) {
  if (!existsSync(target)) return [];
  if (statSync(target).isFile()) return [target];
  const output = runGit(["ls-files", target]);
  if (output) return output.split(/\r?\n/).filter(Boolean);
  return listLocalFiles(target);
}

function listLocalFiles(target) {
  const files = [];
  const ignoredParts = new Set(["node_modules", "dist", "__pycache__", ".pytest_cache", ".chrome-verify"]);
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

const gitAvailable = Boolean(runGit(["rev-parse", "--show-toplevel"]));
const gitignore = existsSync(".gitignore") ? readFileSync(".gitignore", "utf8") : "";
const gitignoreLines = gitignore.split(/\r?\n/);
const missingIgnores = requiredIgnores.filter((entry) => !gitignoreLines.includes(entry));

const tracked = gitAvailable ? runGit(["ls-files"]).split(/\r?\n/).filter(Boolean) : [];
const forbiddenTracked = tracked.filter((file) => forbiddenTrackedPrefixes.some((prefix) => file.startsWith(prefix)));

const scannedFiles = [];
const secretHits = [];

for (const target of scanTargets) {
  for (const file of listFiles(target)) {
    if (!existsSync(file) || statSync(file).size > 750_000) continue;
    const content = readFileSync(file, "utf8");
    scannedFiles.push(file);
    for (const { name, pattern } of tokenPatterns) {
      pattern.lastIndex = 0;
      for (const match of content.matchAll(pattern)) {
        secretHits.push({ file, name, sample: `${match[0].slice(0, 8)}...` });
      }
    }
  }
}

const result = {
  ok: missingIgnores.length === 0 && forbiddenTracked.length === 0 && secretHits.length === 0,
  gitAvailable,
  checked: {
    requiredIgnores: requiredIgnores.length,
    trackedFiles: tracked.length,
    scannedFiles: scannedFiles.length,
  },
  missingIgnores,
  forbiddenTracked,
  secretHits,
};

if (!result.ok) {
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(result, null, 2));
