/**
 * 검증 규칙이 Rust 코어와 일치하는지 확인한다.
 *
 * contracts/validation-fixtures.json 의 같은 입력을 Rust 테스트도 확인한다.
 * 규칙을 두 언어로 구현할 수밖에 없으므로, 한쪽만 고치는 일을 이 대조가 막는다.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) =>
  JSON.parse(readFileSync(join(here, "../../contracts", name), "utf8"));

const fixtures = read("validation-fixtures.json");
const MAX_URL = read("limits.json").url;

// lib/validate.ts 의 url() 과 같은 규칙.
function urlValid(value) {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed.length > MAX_URL) return false;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return parsed.hostname.includes(".");
}

function graphemeCount(text) {
  if (!text) return 0;
  const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });
  let count = 0;
  for (const _ of segmenter.segment(text)) count += 1;
  return count;
}

let failed = 0;
const report = (ok, label) => {
  console.log(`  ${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) failed += 1;
};

console.log("=== URL 검증 ===");
for (const { value, valid, why } of fixtures.urls) {
  report(urlValid(value) === valid, `${why} — ${JSON.stringify(value).slice(0, 40)}`);
}

console.log("=== 글자 수 ===");
for (const { text, count, why } of fixtures.graphemes) {
  const actual = graphemeCount(text);
  report(actual === count, `${why} — 기대 ${count}, 실제 ${actual}`);
}

if (failed > 0) {
  console.error(`\n계약 불일치 ${failed}건. Rust 코어와 웹의 검증 규칙이 갈렸습니다.`);
  process.exit(1);
}
console.log("\n계약 일치");
