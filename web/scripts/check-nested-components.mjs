/**
 * 컴포넌트가 다른 컴포넌트 함수 안에 정의되지 않았는지 확인한다.
 *
 * 중첩 정의하면 부모가 다시 그려질 때마다 React 가 새로운 컴포넌트 종류로
 * 보고 DOM 을 통째로 교체한다. 입력창이 교체되면 한글 조합(IME)이 매 글자마다
 * 끊겨 "ㅌㅇㄹ"처럼 자모가 분리된다.
 *
 * 영문 입력은 조합 과정이 없어 멀쩡해 보이므로, 한국어 사용자에게만 나타나는
 * 버그가 된다. 눈으로 찾기 어려우므로 기계가 본다.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "generated") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

let failed = 0;
for (const file of walk(join(root, "app")).concat(walk(join(root, "components")))) {
  const lines = readFileSync(file, "utf8").split("\n");
  let depth = 0;
  let outerName = null;

  lines.forEach((line, index) => {
    // 컴포넌트로 보이는 함수 선언: 대문자로 시작하는 이름
    const declaration = line.match(/^(\s*)(?:export\s+default\s+|export\s+)?function\s+([A-Z]\w*)/);
    if (declaration) {
      const indent = declaration[1].length;
      if (indent === 0) {
        outerName = declaration[2];
      } else if (outerName) {
        console.error(
          `  FAIL ${relative(root, file)}:${index + 1}  ` +
          `${declaration[2]} 가 ${outerName} 안에 정의되어 있습니다`
        );
        failed += 1;
      }
    }
    // 화살표 함수로 된 중첩 컴포넌트도 본다
    const arrow = line.match(/^(\s+)const\s+([A-Z]\w*)\s*=\s*\(?[^=]*\)?\s*=>\s*[({]/);
    if (arrow && outerName && arrow[1].length > 0) {
      console.error(
        `  FAIL ${relative(root, file)}:${index + 1}  ` +
        `${arrow[2]} 가 ${outerName} 안에 정의되어 있습니다`
      );
      failed += 1;
    }
    void depth;
  });
}

if (failed > 0) {
  console.error(
    `\n중첩 컴포넌트 ${failed}건. 모듈 최상위로 옮기십시오.\n` +
    `입력창이 매 글자마다 교체되어 한글 조합이 깨집니다.`
  );
  process.exit(1);
}
console.log("  OK   중첩 컴포넌트 없음");
