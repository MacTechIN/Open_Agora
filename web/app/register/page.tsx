"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { loadOrCreateDid } from "@/lib/identity";
import { commitmentOf, createPhrase, isValidPhrase, loadPhrase, normalize, savePhrase }
  from "@/lib/anon-client";

/**
 * 시민 인증.
 *
 * 등록된 사람만 글을 쓸 수 있되, 글쓴이는 추적할 수 없어야 한다.
 * 이메일과 신원을 연결해서 저장하지 않는다 — lib/auth.ts 참조.
 */
export default function Register() {
  const [did, setDid] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);
  // 처음 등록인지 기기를 더한 것인지. 같은 문구를 쓰면 이미 가입한 사람이
  // "또 가입됐나?" 하고 헷갈린다.
  const [added, setAdded] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<number | null>(null);

  // 익명 참여용 복구 문구 (VS-C3a). 시민 ID 는 기기에 묶이지만 이 문구는
  // 사람에게 묶인다 — 그래야 기기가 여럿이어도 한 몫만 갖는다.
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [phrase, setPhrase] = useState("");
  const [typed, setTyped] = useState("");
  const [wroteDown, setWroteDown] = useState(false);
  const [anonNote, setAnonNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadOrCreateDid()
      .then(setDid)
      .catch((e) => setError(`시민 ID를 만들지 못했습니다: ${e.message}`));

    // 이 브라우저에 문구가 이미 있으면 그것을 쓴다. 없으면 새로 만든다.
    const saved = loadPhrase();
    if (saved) {
      setPhrase(saved);
      setMode("existing");
      setTyped(saved);
    } else {
      createPhrase().then(setPhrase).catch(() => setPhrase(""));
    }
  }, []);

  async function post(path: string, body: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "요청을 처리하지 못했습니다");
    return data;
  }

  async function requestCode() {
    setBusy(true);
    setError(null);
    try {
      await post("/api/auth/request", { email });
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try {
      // 익명 참여 커밋먼트. 문구에서 결정적으로 나오므로 비밀 자체는 나가지 않는다.
      const secret = mode === "new" ? phrase : normalize(typed);
      let commitment: string | undefined;
      if (secret && (await isValidPhrase(secret))) {
        commitment = await commitmentOf(secret);
      }

      const result = await post("/api/auth/verify", { email, code, did, commitment });
      if (commitment) {
        savePhrase(secret);
        setAnonNote(result.anon?.joined === false
          ? (result.anon.reason ?? "익명 참여 자격을 받지 못했습니다")
          : null);
      }
      setAdded(result.added ?? null);
      setDevices(typeof result.devices === "number" ? result.devices : null);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <h2 style={{ marginTop: 0 }}>인증이 끝났습니다</h2>
        <div className="card">
          <p style={{ margin: 0 }}>이제 주제를 올리고 의견을 남길 수 있습니다.</p>
          <p className="muted" style={{ margin: "8px 0 0" }}>
            {added === false
              ? "이 기기는 이미 등록되어 있었습니다."
              : "이 브라우저의 시민 ID가 등록되었습니다."}
            {devices !== null && ` (등록된 기기 ${devices}대)`}
          </p>
          <p className="muted" style={{ margin: "8px 0 0" }}>
            브라우저 데이터를 지우면 이 기기의 시민 ID가 사라집니다. 그때는
            같은 이메일로 다시 인증하면 됩니다 — 기기가 하나 더해집니다.
          </p>
          {anonNote
            ? <p style={{ margin: "10px 0 0", color: "#d9a441" }}>{anonNote}</p>
            : <p className="muted" style={{ margin: "10px 0 0" }}>
                익명 참여 자격도 함께 등록되었습니다. <strong>복구 문구를 잃지 마세요</strong> —
                다른 기기에서 익명으로 참여하려면 그 문구가 필요하고, 잃으면 되찾을 수 없습니다.
              </p>}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Link href="/"><button>광장으로</button></Link>
          <Link href="/policies/new"><button>주제 올리기</button></Link>
        </div>
      </>
    );
  }

  return (
    <>
      <Link href="/" className="muted">← 광장으로</Link>
      <h2 style={{ marginTop: 14 }}>시민 인증</h2>

      <div className="card">
        <p style={{ marginTop: 0 }}>
          글을 쓰려면 이메일 인증이 필요합니다.
          <strong> 이미 인증한 분도 기기를 바꾸면 여기서 다시 인증해 주세요.</strong>
        </p>
        <p className="muted" style={{ marginTop: 8 }}>
          시민 ID는 기기 안에서 만들어지고 <strong>기기 밖으로 나오지 않습니다</strong>.
          그래서 브라우저·윈도우 앱·안드로이드 앱이 각각 다른 ID를 갖습니다.
          같은 이메일로 다시 인증하면 <strong>그 기기가 추가</strong>됩니다 —
          새로 가입되는 것이 아닙니다. 한 이메일로 최대 5대까지입니다.
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          인증이 끝나면 회원 자격만 남습니다. <strong>어떤 글이 누구의 것인지는
          저장하지 않습니다.</strong> 이메일 주소도 원문 대신 되돌릴 수 없는
          형태로만 보관합니다.
        </p>
      </div>

      <div className="card">
        <div className="field">
          <strong style={{ display: "block", marginBottom: 6 }}>이메일</strong>
          <input
            type="email"
            value={email}
            placeholder="name@example.com"
            disabled={sent}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        {!sent && (
          <button onClick={requestCode} disabled={busy || !email.includes("@")} style={{ width: "100%" }}>
            {busy ? "보내는 중…" : "인증코드 받기"}
          </button>
        )}

        {sent && (
          <>
            <div className="field">
              <strong style={{ display: "block", marginBottom: 6 }}>인증코드 (6자리)</strong>
              <input
                value={code}
                placeholder="000000"
                inputMode="numeric"
                maxLength={6}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
              <div className="hint">메일함을 확인해 주세요. 10분 안에 입력해야 합니다.</div>
            </div>
            <div className="field" style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <strong style={{ display: "block", marginBottom: 6 }}>익명 참여용 복구 문구</strong>
              <div className="hint" style={{ marginBottom: 10 }}>
                시민 ID는 기기에 묶이지만 이 문구는 <strong>사람에게 묶입니다.</strong>
                나중에 반응·투표처럼 <strong>한 사람이 한 번만</strong> 할 수 있는 일에
                쓰이며, 그때 서버는 누가 눌렀는지 알지 못합니다.
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button type="button" onClick={() => setMode("new")}
                        style={{ flex: 1, opacity: mode === "new" ? 1 : 0.55 }}>
                  처음입니다
                </button>
                <button type="button" onClick={() => setMode("existing")}
                        style={{ flex: 1, opacity: mode === "existing" ? 1 : 0.55 }}>
                  문구가 있습니다
                </button>
              </div>

              {mode === "new" ? (
                <>
                  <div style={{ fontFamily: "monospace", fontSize: 14, lineHeight: 1.9,
                                padding: 12, background: "rgba(255,255,255,0.04)",
                                borderRadius: 8, wordSpacing: 6 }}>
                    {phrase || "문구를 만드는 중…"}
                  </div>
                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 10 }}>
                    <input type="checkbox" checked={wroteDown}
                           onChange={(e) => setWroteDown(e.target.checked)} />
                    <span className="hint" style={{ margin: 0 }}>
                      적어 두었습니다. <strong>잃으면 되찾을 수 없다는 것</strong>을 압니다 —
                      서버가 복구해 줄 수 있다면 서버가 내 표를 흉내 낼 수 있다는 뜻이므로,
                      복구가 안 되는 것이 이 설계의 성질입니다.
                    </span>
                  </label>
                </>
              ) : (
                <>
                  <textarea
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder="12단어를 띄어쓰기로 구분해 입력해 주세요"
                    rows={3}
                    style={{ width: "100%", fontFamily: "monospace" }}
                  />
                  <div className="hint">
                    처음 인증할 때 받은 문구입니다. 없으면 「처음입니다」를 고르세요 —
                    다만 한 이메일에 하나만 발급되므로, 이미 받으셨다면 새로 만들 수 없습니다.
                  </div>
                </>
              )}
            </div>

            <button onClick={verify}
                    disabled={busy || code.length !== 6 || !did
                              || (mode === "new" ? !wroteDown || !phrase : normalize(typed).split(" ").length !== 12)}
                    style={{ width: "100%" }}>
              {busy ? "확인 중…" : "인증 완료하기"}
            </button>
            <button
              onClick={() => { setSent(false); setCode(""); setError(null); }}
              disabled={busy}
              style={{ width: "100%", marginTop: 8, background: "transparent", border: "1px solid var(--border)", color: "var(--muted)" }}
            >
              이메일 다시 입력
            </button>
          </>
        )}

        {error && <div className="error">{error}</div>}
      </div>
    </>
  );
}
