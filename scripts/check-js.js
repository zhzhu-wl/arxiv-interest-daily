#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const CHECK_DIRS = [
  path.join(ROOT, "plugin"),
  path.join(ROOT, "scripts"),
];

function listJavaScriptFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      out.push(...listJavaScriptFiles(abs));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      out.push(abs);
    }
  }
  return out;
}

function main() {
  const files = CHECK_DIRS.flatMap(listJavaScriptFiles);
  let failed = 0;
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], {
      cwd: ROOT,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      failed++;
      process.stderr.write(result.stderr || result.stdout || `Syntax check failed: ${file}\n`);
    }
  }
  if (failed) {
    throw new Error(`${failed}/${files.length} JavaScript files failed syntax checks`);
  }
  console.log(`Checked ${files.length} JavaScript files.`);
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
