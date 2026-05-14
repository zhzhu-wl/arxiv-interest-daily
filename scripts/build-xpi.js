#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
const PLUGIN_DIR = path.join(ROOT, "plugin");
const BUILD_DIR = path.join(ROOT, "build");
const OUTPUT_DIR = process.env.XPI_OUTPUT_DIR
  ? path.resolve(ROOT, process.env.XPI_OUTPUT_DIR)
  : BUILD_DIR;
const MANIFEST_PATH = path.join(PLUGIN_DIR, "manifest.json");
const UPDATES_PATH = path.join(ROOT, "updates.json");

const REQUIRED_ENTRIES = [
  "manifest.json",
  "bootstrap.js",
  "src/main.js",
  "src/storage/data-dir.js",
];

const EXCLUDE_NAMES = new Set([
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
]);

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { dosDate, dosTime };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function toZipEntryName(absFile) {
  const rel = path.relative(PLUGIN_DIR, absFile);
  const entry = rel.split(path.sep).join("/");
  if (!entry || entry.startsWith("../") || entry.includes("..\\") || path.isAbsolute(entry)) {
    throw new Error(`Unsafe zip entry name: ${entry}`);
  }
  if (entry.includes("\\")) {
    throw new Error(`Zip entry contains a backslash: ${entry}`);
  }
  return entry;
}

function shouldInclude(absFile) {
  const name = path.basename(absFile);
  if (EXCLUDE_NAMES.has(name)) return false;
  if (name.endsWith("~") || name.endsWith(".tmp") || name.endsWith(".bak")) return false;
  const rel = path.relative(PLUGIN_DIR, absFile);
  const parts = rel.split(path.sep);
  if (parts.some((part) => part === "__MACOSX" || part === ".git" || part === "node_modules")) {
    return false;
  }
  return true;
}

function listFiles(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(abs));
    } else if (entry.isFile() && shouldInclude(abs)) {
      out.push(abs);
    }
  }
  return out;
}

function writeUInt16(value) {
  const buf = Buffer.allocUnsafe(2);
  buf.writeUInt16LE(value & 0xffff, 0);
  return buf;
}

function writeUInt32(value) {
  const buf = Buffer.allocUnsafe(4);
  buf.writeUInt32LE(value >>> 0, 0);
  return buf;
}

function createZip(files, outPath) {
  const fileRecords = [];
  const chunks = [];
  let offset = 0;

  for (const absFile of files) {
    const entryName = toZipEntryName(absFile);
    const nameBytes = Buffer.from(entryName, "utf8");
    const source = fs.readFileSync(absFile);
    const deflated = zlib.deflateRawSync(source, { level: 9 });
    const useDeflate = deflated.length < source.length;
    const payload = useDeflate ? deflated : source;
    const method = useDeflate ? 8 : 0;
    const stat = fs.statSync(absFile);
    const { dosDate, dosTime } = dosDateTime(stat.mtime);
    const crc = crc32(source);

    const localHeader = Buffer.concat([
      writeUInt32(0x04034b50),
      writeUInt16(20),
      writeUInt16(0x0800),
      writeUInt16(method),
      writeUInt16(dosTime),
      writeUInt16(dosDate),
      writeUInt32(crc),
      writeUInt32(payload.length),
      writeUInt32(source.length),
      writeUInt16(nameBytes.length),
      writeUInt16(0),
      nameBytes,
    ]);

    chunks.push(localHeader, payload);
    fileRecords.push({
      entryName,
      nameBytes,
      method,
      dosDate,
      dosTime,
      crc,
      compressedSize: payload.length,
      uncompressedSize: source.length,
      localHeaderOffset: offset,
    });
    offset += localHeader.length + payload.length;
  }

  const centralStart = offset;
  for (const record of fileRecords) {
    const centralHeader = Buffer.concat([
      writeUInt32(0x02014b50),
      writeUInt16(20),
      writeUInt16(20),
      writeUInt16(0x0800),
      writeUInt16(record.method),
      writeUInt16(record.dosTime),
      writeUInt16(record.dosDate),
      writeUInt32(record.crc),
      writeUInt32(record.compressedSize),
      writeUInt32(record.uncompressedSize),
      writeUInt16(record.nameBytes.length),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt16(0),
      writeUInt32(0),
      writeUInt32(record.localHeaderOffset),
      record.nameBytes,
    ]);
    chunks.push(centralHeader);
    offset += centralHeader.length;
  }
  const centralSize = offset - centralStart;
  const endOfCentralDirectory = Buffer.concat([
    writeUInt32(0x06054b50),
    writeUInt16(0),
    writeUInt16(0),
    writeUInt16(fileRecords.length),
    writeUInt16(fileRecords.length),
    writeUInt32(centralSize),
    writeUInt32(centralStart),
    writeUInt16(0),
  ]);
  chunks.push(endOfCentralDirectory);
  fs.writeFileSync(outPath, Buffer.concat(chunks));
  return fileRecords.map((record) => record.entryName);
}

function readManifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
}

function validateEntries(entries) {
  const entrySet = new Set(entries);
  const missing = REQUIRED_ENTRIES.filter((entry) => !entrySet.has(entry));
  if (missing.length) {
    throw new Error(`XPI is missing required entries: ${missing.join(", ")}`);
  }
  const bad = entries.filter((entry) => entry.includes("\\") || entry.startsWith("/") || entry.includes("../"));
  if (bad.length) {
    throw new Error(`XPI contains unsafe entries: ${bad.join(", ")}`);
  }
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function writeUpdatesJson(manifest, xpiName, hash) {
  const addon = manifest.applications && manifest.applications.zotero;
  if (!addon || !addon.id) return;
  const updateLink =
    `https://github.com/zhzhu-wl/arxiv-interest-daily/releases/download/v${manifest.version}/${xpiName}`;
  const updates = {
    addons: {
      [addon.id]: {
        updates: [
          {
            version: manifest.version,
            update_link: updateLink,
            update_hash: `sha256:${hash}`,
            applications: {
              zotero: {
                strict_min_version: addon.strict_min_version,
                strict_max_version: addon.strict_max_version,
              },
            },
          },
        ],
      },
    },
  };
  fs.writeFileSync(UPDATES_PATH, `${JSON.stringify(updates, null, 2)}\n`, "utf8");
}

function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Missing manifest: ${MANIFEST_PATH}`);
  }
  const manifest = readManifest();
  const version = process.argv[2] || manifest.version;
  if (version !== manifest.version) {
    throw new Error(`Version argument ${version} does not match plugin/manifest.json ${manifest.version}`);
  }
  ensureDir(OUTPUT_DIR);
  const xpiName = process.env.XPI_OUTPUT_NAME || `arxiv-interest-daily-v${manifest.version}.xpi`;
  const outPath = path.join(OUTPUT_DIR, xpiName);
  const files = listFiles(PLUGIN_DIR);
  const entries = createZip(files, outPath);
  validateEntries(entries);
  const hash = sha256(outPath);
  writeUpdatesJson(manifest, xpiName, hash);

  console.log(`Built ${path.relative(ROOT, outPath)}`);
  console.log(`Files: ${entries.length}`);
  console.log(`SHA-256: ${hash}`);
  console.log("Verified: required entries present and all XPI entry names use '/'.");
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
