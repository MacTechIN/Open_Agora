/**
 * 톤 스크리닝이 코어와 같은 점수를 내는지 확인한다 (VS-E1).
 *
 * 이 규칙은 코어(Rust)와 웹(TypeScript) 두 곳에 있다. 브라우저 안에서 돌아야
 * 하므로 웹이 Rust 를 부를 수 없다. 한쪽만 고치면 같은 문장이 기기마다 다르게
 * 판정되고, 그 차이는 사용자가 "왜 나만 검토 중이 뜨지"라고 물을 때에야 드러난다.
 *
 * 어휘 목록에 정치 용어가 끼어들지 않았는지도 함께 본다. 그것이 들어가는
 * 순간 이 플랫폼은 막으려던 바로 그 일을 하게 된다.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const { screen, STEP2_THRESHOLD, BANNER_THRESHOLD } = await import("../lib/screening.ts");
const doc = JSON.parse(readFileSync(join(here, "../lib/generated/screening-vectors.json"), "utf8"));

let failed = 0;
const ok = (name) => console.log(`  OK   ${name}`);
const bad = (name, detail) => { console.error(`  FAIL ${name} — ${detail}`); failed += 1; };

if (STEP2_THRESHOLD !== doc.step2_threshold) bad("2단계 문턱", "코어와 다릅니다");
if (BANNER_THRESHOLD !== doc.banner_threshold) bad("배너 문턱", "코어와 다릅니다");

for (const testCase of doc.cases) {
  const result = screen(testCase.text);
  const label = testCase.text ? testCase.text.slice(0, 20) : "(빈 문자열)";
  if (Math.abs(result.score - testCase.score) > 1e-9) {
    bad(label, `점수 ${result.score} ≠ ${testCase.score}`);
  } else if (result.needs_review !== testCase.needs_review) {
    bad(label, `검토 판정 ${result.needs_review} ≠ ${testCase.needs_review}`);
  } else {
    ok(`${label}  ${result.score.toFixed(2)}`);
  }
}

// 정치 용어가 목록에 끼어들지 않았는가. 코어에도 같은 시험이 있다.
const FORBIDDEN = ["민주", "국민의힘", "보수", "진보", "좌파", "우파", "빨갱이",
                   "토착왜구", "페미", "한남", "김치녀", "대통령", "정부", "야당", "여당"];
const source = readFileSync(join(here, "../lib/screening.ts"), "utf8");
const lexicon = source.slice(source.indexOf("const LEXICON"), source.indexOf("];", source.indexOf("const LEXICON")));
for (const term of FORBIDDEN) {
  if (lexicon.includes(term)) bad("어휘 목록", `정치 용어가 들어 있습니다: ${term}`);
}
if (!failed) ok("어휘 목록에 정치 용어 없음");

// 지연시간 예산. 타이핑마다 도는 코드라 기준이 있다(<30ms).
// 지금은 어휘 훑기라 여유뿐이지만, 신경망이 들어오면 여기가 예산선이 된다.
const long = "탄력 근로제는 업종별로 기준을 달리해야 합니다. ".repeat(20).slice(0, 500);
const started = performance.now();
for (let i = 0; i < 100; i += 1) screen(long);
const perCall = (performance.now() - started) / 100;
if (perCall >= 30) bad("지연시간", `한 번에 ${perCall.toFixed(2)}ms — 예산은 30ms`);
else ok(`지연시간  ${perCall.toFixed(3)}ms / 500자`);

if (failed) {
  console.error(`\n스크리닝이 코어와 어긋납니다 (${failed}건).`);
  process.exit(1);
}
console.log("  OK   스크리닝이 코어와 같음");
