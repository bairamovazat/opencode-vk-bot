#!/usr/bin/env node
// Secrets gate (constitution III): scans staged diffs for token patterns.
import { execSync } from "node:child_process";

const PATTERNS = [
  [/vk1\.a\.[A-Za-z0-9_-]{10,}/, "VK community token"],
  [/[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}/, "Telegram-style bot token"],
  [/-----BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY-----/, "private key"],
  [/ghp_[A-Za-z0-9]{36}/, "GitHub PAT"],
  [/sk-[A-Za-z0-9]{20,}/, "OpenAI-style key"],
];

function stagedFiles() {
  try {
    const out = execSync("git diff --cached --name-only", { encoding: "utf8" });
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

let findings = 0;
for (const file of stagedFiles()) {
  let content = "";
  try {
    content = execSync(`git show ":${file}"`, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  } catch {
    continue;
  }
  for (const [pattern, label] of PATTERNS) {
    if (pattern.test(content)) {
      console.error(`SECRET FOUND in ${file}: ${label}`);
      findings += 1;
    }
  }
}

if (findings > 0) {
  console.error(`secrets-scan: ${findings} finding(s). Commit blocked.`);
  process.exit(1);
}
console.log("secrets-scan: clean");
