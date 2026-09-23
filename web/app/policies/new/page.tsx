"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CountedField, { PlainField } from "@/components/CountedField";
import ErrorNotice from "@/components/ErrorNotice";
import MemberGate from "@/components/MemberGate";
import OpinionForm, { EMPTY_OPINION, opinionReady, type OpinionValue } from "@/components/OpinionForm";
import { loadOrCreateDid, signWithDevice } from "@/lib/identity";
import { opinionPayload, policyPayload } from "@/lib/signing";
import { LIMITS, graphemeCount } from "@/lib/limits";
import { contentId } from "@/lib/validate";
import { CATEGORY_LABEL, type Category } from "@/lib/types";

export default function NewPolicy() {
  const router = useRouter();
  const [did, setDid] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Category>("GOV_POLICY");
  const [background, setBackground] = useState("");
  const [question, setQuestion] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [agency, setAgency] = useState("");
  const [opinion, setOpinion] = useState<OpinionValue>(EMPTY_OPINION);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadOrCreateDid().then(setDid).catch((e) => setError(`시민 ID를 만들지 못했습니다: ${e.message}`));
  }, []);

  const within = (text: string, limit: number) => {
    const n = graphemeCount(text.trim());
    return n > 0 && n <= limit;
  };
  const ready =
    did !== null && !busy &&
    within(title, LIMITS.policy.title) &&
    within(background, LIMITS.policy.background) &&
    within(question, LIMITS.policy.coreQuestion) &&
    sourceUrl.trim().length > 0 &&
    opinionReady(opinion);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      // 보내기 전에 기기 키로 서명한다. 서버가 글을 고치면 이 서명이 깨지므로
      // 고친 사실이 드러난다 (VS-A4).
      const createdAt = Date.now();
      const policyFields = {
        title,
        category,
        background,
        core_question: question,
        official_source_url: sourceUrl.trim(),
        target_agency: agency.trim() || null,
      };
      const signed = {
        author_did: did!,
        created_at: createdAt,
        ...policyFields,
        // 서버는 다듬은 값을 저장하므로 서명도 그 값에 해야 한다.
        title: title.trim(),
        background: background.trim(),
        core_question: question.trim(),
      };
      const policySignature = await signWithDevice(policyPayload(signed));

      // 첫 의견의 서명은 주제 식별자를 덮어야 한다. 그러지 않으면 같은 서명을
      // 다른 주제에 옮겨 붙일 수 있다. 식별자는 내용 해시이므로 서버와 같은
      // 규칙으로 여기서도 만들 수 있다 — 둘이 갈리면 서명 검증이 실패하므로
      // 조용히 어긋나지는 않는다.
      const policyId = await contentId([
        did!, String(createdAt), signed.title, signed.background, signed.core_question,
      ]);
      const opinionSignature = await signWithDevice(opinionPayload({
        policy_id: policyId,
        author_did: did!,
        created_at: createdAt,
        stance: opinion.stance,
        problem_definition: opinion.problem_definition.trim(),
        evidence_source: opinion.evidence_source.trim(),
        evidence_url: opinion.evidence_url.trim(),
        actionable_solution: opinion.actionable_solution.trim(),
      }));

      const response = await fetch("/api/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author_did: did,
          created_at: createdAt,
          policy: policyFields,
          first_opinion: opinion,
          policy_signature: policySignature,
          opinion_signature: opinionSignature,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "등록하지 못했습니다");
      router.push(`/policies/${data.policy_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <MemberGate>
      <h2 style={{ marginTop: 0 }}>주제 올리기</h2>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>무엇을 공론화하려 하시나요?</h3>

        <CountedField label="주제 제목" value={title} limit={LIMITS.policy.title}
                      multiline={false} onChange={setTitle}
                      placeholder="예) 탄력 근로제 직종별 차등 적용" />

        <div className="field">
          <strong style={{ display: "block", marginBottom: 6 }}>분류</strong>
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {Object.entries(CATEGORY_LABEL).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>

        <CountedField label="왜 지금 이슈인가요?" value={background} limit={LIMITS.policy.background}
                      onChange={setBackground}
                      placeholder="예) 최근 개정안이 발의되면서 업종별 적용 기준을 두고 노사 간 이견이 커지고 있습니다." />

        <CountedField label="쟁점 질문" value={question} limit={LIMITS.policy.coreQuestion}
                      multiline={false} onChange={setQuestion}
                      placeholder="예) 직종별로 탄력 근로제 적용 기준을 달리해야 하는가?"
                      hint={<>
                        찬성과 반대가 갈릴 수 있는 <strong>하나의 질문</strong>으로 적어주세요.
                        이 질문이 토론의 축이 됩니다.
                        <br />
                        좋은 예: &quot;지역화폐 발행을 계속해야 하는가?&quot; ·
                        피할 예: &quot;지역화폐 어떻게 생각하세요?&quot; (찬반이 성립하지 않음)
                      </>} />

        <PlainField label="공식 출처 링크" value={sourceUrl} onChange={setSourceUrl}
                    placeholder="https://likms.assembly.go.kr/..."
                    hint="법령, 의안, 보도자료 같은 1차 자료를 적어주세요." />

        <PlainField label="소관 기관" value={agency} onChange={setAgency}
                    placeholder="예) 고용노동부" optional />
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>이 질문에 대한 내 입장</h3>
        <div className="hint" style={{ marginTop: -8, marginBottom: 16 }}>
          주제를 여는 분도 자기 의견을 함께 남깁니다. 토론이 빈 상태로 시작하지 않도록 하기 위해서입니다.
        </div>
        <OpinionForm value={opinion} onChange={setOpinion} />
      </div>

      {error && <ErrorNotice message={error} />}

      <button onClick={submit} disabled={!ready} style={{ width: "100%" }}>
        {busy ? "올리는 중…" : "주제 올리기"}
      </button>
      <div className="hint" style={{ marginTop: 10 }}>
        올린 글은 수정하거나 지울 수 없습니다. 누구도 기록을 바꿀 수 없게 만든 공론장이기 때문입니다.
      </div>
    </MemberGate>
  );
}
