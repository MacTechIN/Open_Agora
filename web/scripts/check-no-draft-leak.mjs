/**
 * 작성 중인 글이 기기 밖으로 나가지 않는지 검사한다 (G-PRIV, VS-E1).
 *
 * 톤 스크리닝을 기기 안에 둔 이유가 이것이다. 타이핑하는 동안 매 글자가
 * 서버로 간다면 **지우고 다시 쓴 문장까지 남는다.** 쓰다 만 말은 쓴 말보다
 * 사람을 더 많이 드러낸다.
 *
 * 위험은 나중에 무심코 들어온다 — 자동 저장, 분석 도구, "초안 복구" 기능.
 * 어느 것도 악의가 없지만 결과는 같다. 그래서 기계가 본다.
 *
 * ## 무엇을 보는가
 *
 * 스크리닝 모듈이 네트워크를 쓰지 않는가, 그리고 본문 입력 컴포넌트가
 * **명시적인 제출 경로 밖에서** 네트워크를 부르지 않는가.
 *
 * 제출은 당연히 서버로 간다. 막으려는 것은 제출이 아니라 **제출하지 않은
 * 글**이 나가는 것이다.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const repo = join(here, "../..");

/** 네트워크를 부르는 흔적. 플랫폼마다 이름이 다르다. */
const NETWORK =
  /\b(fetch|XMLHttpRequest|sendBeacon|WebSocket|EventSource|HttpClient|SendAsync|HttpURLConnection|URLSession|ApiClient)\b/;

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

let failed = 0;
const ok = (name) => console.log(`  OK   ${name}`);
const bad = (name, why) => { console.error(`  FAIL ${name} — ${why}`); failed += 1; };

// 1) 스크리닝 모듈은 네트워크를 전혀 쓰지 않아야 한다.
//    이 모듈이 서버를 부르면 기기 안에서 도는 의미가 없다.
const screening = stripComments(readFileSync(join(root, "lib/screening.ts"), "utf8"));
if (NETWORK.test(screening)) bad("lib/screening.ts", "네트워크를 부릅니다");
else ok("lib/screening.ts  네트워크 호출 없음");

// 2) 본문 입력 컴포넌트가 제출 밖에서 네트워크를 부르지 않아야 한다.
//    타이핑 중 도는 코드(useEffect, onChange)와 네트워크가 같은 파일에
//    있으면, 초안이 나갈 길이 생긴 것이다.
//    **네 플랫폼 모두** 본다. 보장이 한 곳에만 걸리면 보장이 아니다.
const COMPOSERS = [
  [root, "components/OpinionForm.tsx"],
  [root, "components/CountedField.tsx"],
  [root, "components/ToneNotice.tsx"],
  [repo, "apps/windows/OpinionForm.cs"],
  [repo, "apps/android/app/src/main/kotlin/org/civicagora/app/OpinionForm.kt"],
  [repo, "apps/ios/CivicAgora/OpinionFormView.swift"],
];
for (const [base, rel] of COMPOSERS) {
  let source;
  try {
    source = stripComments(readFileSync(join(base, rel), "utf8"));
  } catch {
    bad(rel, "파일이 없습니다. 이름이 바뀌었으면 이 목록도 고치십시오");
    continue;
  }
  if (NETWORK.test(source)) {
    bad(rel, "본문 입력 컴포넌트가 네트워크를 부릅니다 — 초안이 나갈 수 있습니다");
  } else {
    ok(`${rel}  네트워크 호출 없음`);
  }
}

if (failed) {
  console.error(`\n작성 중인 글이 나갈 수 있는 경로 ${failed}건.`);
  process.exit(1);
}
console.log("  OK   작성 중인 글이 기기 밖으로 나가지 않음");
