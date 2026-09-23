using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using CivicAgora.Core;

namespace CivicAgora.Windows;

/// <summary>
/// 공유 API 클라이언트.
///
/// **전송만 담당한다.** 요청 본문 생성과 응답 파싱은 코어가 한다
/// (core/src/api.rs). 두 플랫폼이 각자 JSON 을 조립하면 필드가 어긋나고,
/// 그 버그는 서버 로그에서만 보인다.
///
/// HTTP 를 플랫폼에 맡기는 이유는 OS 의 프록시·인증서 정책을 그대로 쓰기
/// 위해서다. Rust 에 TLS 를 넣으면 그것을 잃고 크로스 컴파일 위험도 커진다.
/// </summary>
public sealed class ApiClient
{
    /// <summary>
    /// 공론장 주소.
    ///
    /// 환경변수로 덮어쓸 수 있게 둔다. 로컬 서버로 시험할 때 쓴다.
    /// </summary>
    private static readonly string BaseUrl =
        Environment.GetEnvironmentVariable("CIVICAGORA_API")?.TrimEnd('/')
        ?? "https://open-agora.vercel.app";

    private readonly HttpClient _http = new()
    {
        // 무응답 서버에 무한정 기다리면 앱이 멈춘 것처럼 보인다.
        Timeout = TimeSpan.FromSeconds(20),
    };

    /// <summary>
    /// 통신 실패.
    ///
    /// record 로 두면 CS8864 가 난다 — record 는 object 나 다른 record 만
    /// 상속할 수 있고 Exception 은 둘 다 아니다.
    /// </summary>
    public sealed class Failure : Exception
    {
        public Failure(string message) : base(message) { }
    }

    private async Task<string> SendAsync(HttpMethod method, string path, string? body = null)
    {
        using var request = new HttpRequestMessage(method, BaseUrl + path);
        if (body is not null)
        {
            request.Content = new StringContent(body, Encoding.UTF8, "application/json");
        }

        HttpResponseMessage response;
        try
        {
            response = await _http.SendAsync(request);
        }
        catch (Exception ex)
        {
            // 연결 실패와 서버 오류를 구분한다. 사용자가 할 일이 다르다.
            throw new Failure($"공론장에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.\n({ex.Message})");
        }

        var text = await response.Content.ReadAsStringAsync();

        // 4xx 는 본문에 사용자용 안내가 들어 있다. 코어가 꺼내 쓰도록 그대로 넘긴다.
        if (!response.IsSuccessStatusCode && text.Length == 0)
        {
            throw new Failure($"서버가 응답하지 않았습니다 ({(int)response.StatusCode})");
        }
        return text;
    }

    /// <summary>광장 목록.</summary>
    public async Task<List<PolicySummary>> ListPoliciesAsync()
    {
        var json = await SendAsync(HttpMethod.Get, "/api/policies");
        return CivicagoraMethods.ParsePolicies(json);
    }

    /// <summary>한 주제의 의견 전부.</summary>
    public async Task<List<DebateCard>> ListOpinionsAsync(string policyId)
    {
        var json = await SendAsync(HttpMethod.Get, $"/api/policies/{policyId}");
        return CivicagoraMethods.ParseOpinions(json);
    }

    /// <summary>
    /// 주제를 열고 첫 의견을 함께 등록한다.
    ///
    /// 보내기 전에 기기 키로 서명한다(VS-A4). 서버가 글을 고치면 이 서명이
    /// 깨지므로 고친 사실이 드러난다.
    /// </summary>
    public async Task<string> OpenPolicyAsync(DraftPolicy policy, DraftCard firstOpinion, string authorDid)
    {
        // 시각을 여기서 정한다. 서명이 시각을 덮으려면 서명하는 쪽이 그 값을
        // 알아야 하기 때문이다. 서버가 정하면 서버가 시각을 바꿔도 검증이 통과한다.
        var createdAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        // 서명 대상 바이트는 코어가 만든다. 검증과 같은 형식이어야 하는데,
        // 플랫폼이 각자 조립하면 바이트 한 칸이 어긋나고 그 버그는 검증 실패로만
        // 나타나 원인을 찾기 어렵다.
        var policySignature = DeviceIdentity.Sign(
            CivicagoraMethods.PolicySigningPayload(policy, authorDid, createdAt));

        // 첫 의견의 서명은 주제 식별자를 덮어야 한다. 그러지 않으면 같은 서명을
        // 다른 주제에 옮겨 붙일 수 있다.
        var policyId = CivicagoraMethods.PolicyId(policy, authorDid, createdAt);
        var opinionSignature = DeviceIdentity.Sign(
            CivicagoraMethods.OpinionSigningPayload(policyId, firstOpinion, authorDid, createdAt));

        // 보내기 전에 코어가 검증한다. 왕복 없이 알려주는 편이 낫고,
        // 네트워크가 없을 때도 입력 문제를 알 수 있다.
        var body = CivicagoraMethods.OpenPolicyBody(
            policy, firstOpinion, authorDid, createdAt, policySignature, opinionSignature);
        var json = await SendAsync(HttpMethod.Post, "/api/policies", body);
        return CivicagoraMethods.ParseId(json);
    }

    /// <summary>기존 주제에 의견을 추가한다. 보내기 전에 서명한다.</summary>
    public async Task<string> AddOpinionAsync(string policyId, DraftCard card, string authorDid)
    {
        var createdAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var signature = DeviceIdentity.Sign(
            CivicagoraMethods.OpinionSigningPayload(policyId, card, authorDid, createdAt));

        var body = CivicagoraMethods.AddOpinionBody(card, authorDid, createdAt, signature);
        var json = await SendAsync(HttpMethod.Post, $"/api/policies/{policyId}/opinions", body);
        return CivicagoraMethods.ParseId(json);
    }

    /// <summary>
    /// 이 기기가 회원인가.
    ///
    /// 시작할 때 조용히 확인한다. 이것이 없으면 사용자는 글을 다 쓰고 등록을
    /// 누른 뒤에야 막힌다 — 특히 기기를 바꾼 사람은 분명히 가입했는데 아니라고
    /// 하니 이유를 알 수 없다.
    /// </summary>
    public async Task<bool> IsMemberAsync(string did)
    {
        var json = await SendAsync(HttpMethod.Get,
            $"/api/auth/status?did={Uri.EscapeDataString(did)}");
        using var document = System.Text.Json.JsonDocument.Parse(json);
        return document.RootElement.TryGetProperty("member", out var value)
               && value.ValueKind == System.Text.Json.JsonValueKind.True;
    }

    /// <summary>인증코드를 요청한다.</summary>
    public async Task RequestCodeAsync(string email)
    {
        var body = System.Text.Json.JsonSerializer.Serialize(new { email });
        var json = await SendAsync(HttpMethod.Post, "/api/auth/request", body);
        ThrowIfError(json);
    }

    /// <summary>코드를 확인하고 시민으로 등록한다.</summary>
    public async Task VerifyAsync(string email, string code, string did)
    {
        var body = System.Text.Json.JsonSerializer.Serialize(new { email, code, did });
        var json = await SendAsync(HttpMethod.Post, "/api/auth/verify", body);
        ThrowIfError(json);
    }

    /// <summary>
    /// 인증 응답의 오류를 꺼낸다.
    ///
    /// 주제·의견 응답은 코어가 오류를 꺼내지만, 인증 응답은 코어를 거치지
    /// 않으므로 여기서 본다.
    /// </summary>
    private static void ThrowIfError(string json)
    {
        try
        {
            using var document = System.Text.Json.JsonDocument.Parse(json);
            if (document.RootElement.TryGetProperty("error", out var error))
            {
                throw new Failure(error.GetString() ?? "요청을 처리하지 못했습니다");
            }
        }
        catch (System.Text.Json.JsonException)
        {
            throw new Failure("서버 응답을 읽지 못했습니다");
        }
    }
}
