/**
 * 반응자 목록이 새어 나가지 않는지 검사한다 (G-PRIV, INV-3).
 *
 * 명세는 "누가 무엇을 눌렀는지는 누구에게도 공개되지 않는다"이고, VS-D2 의
 * 수용 기준은 **반응자 목록 화면이나 API 가 존재하지 않음**이다.
 *
 * 집계는 공개하고 개인은 감추는 구조라, 실수로 한 줄을 추가하면 그대로
 * 목록이 된다. `SELECT *` 하나, 응답에 필명 한 필드면 끝이다. 눈으로는
 * 놓치기 쉬워 기계가 본다.
 *
 * 쓰기 경로(lib/reactions.ts)는 필명을 다뤄야 하므로 검사 대상이 아니다.
 * 검사하는 것은 **밖으로 나가는 길** — app/ 아래의 라우트와 화면이다.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** 반응자를 가리키는 것들. 밖으로 나가는 코드에 나타나면 안 된다. */
const FORBIDDEN = [
  { pattern: /\bpseudonym\b/, why: "필명이 응답에 실릴 수 있습니다" },
  { pattern: /\bnullifier\b/, why: "nullifier 는 필명입니다" },
  { pattern: /FROM\s+reactions/i, why: "반응 표를 직접 읽습니다. lib/reactions.ts 의 집계 함수를 쓰십시오" },
  { pattern: /FROM\s+anon_actions/i, why: "익명 행동 표를 직접 읽습니다" },
];

/**
 * 주석을 걷어낸다.
 *
 * 설계를 설명한 문장에서 걸리면, 설명을 지우는 쪽으로 사람을 몰게 된다.
 * 그러면 게이트가 코드가 아니라 주석을 지배한다.
 *
 * 블록 주석과 **줄 전체가 주석인 줄**만 지운다. 코드 줄 끝의 `//` 까지
 * 지우려 하면 문자열 안의 `https://` 를 잘라 뒤 코드를 통째로 숨긴다.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

let failed = 0;
let checked = 0;
for (const file of walk(join(root, "app")).concat(walk(join(root, "components")))) {
  const source = stripComments(readFileSync(file, "utf8"));
  const rel = relative(root, file).replace(/\\/g, "/");
  checked += 1;
  for (const { pattern, why } of FORBIDDEN) {
    if (pattern.test(source)) {
      console.error(`  FAIL ${rel}  ${why}`);
      failed += 1;
    }
  }
}

if (failed) {
  console.error(`\n반응자를 드러내는 경로 ${failed}건. 집계만 공개해야 합니다.`);
  process.exit(1);
}
console.log(`  OK   ${checked}개 파일에 반응자 목록 경로 없음`);
