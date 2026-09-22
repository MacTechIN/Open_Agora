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

    public sealed record Failure(string Message) : Exception(Message);

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

    /// <summary>주제를 열고 첫 의견을 함께 등록한다.</summary>
    public async Task<string> OpenPolicyAsync(DraftPolicy policy, DraftCard firstOpinion, string authorDid)
    {
        // 보내기 전에 코어가 검증한다. 왕복 없이 알려주는 편이 낫고,
        // 네트워크가 없을 때도 입력 문제를 알 수 있다.
        var body = CivicagoraMethods.OpenPolicyBody(policy, firstOpinion, authorDid);
        var json = await SendAsync(HttpMethod.Post, "/api/policies", body);
        return CivicagoraMethods.ParseId(json);
    }

    /// <summary>기존 주제에 의견을 추가한다.</summary>
    public async Task<string> AddOpinionAsync(string policyId, DraftCard card, string authorDid)
    {
        var body = CivicagoraMethods.AddOpinionBody(card, authorDid);
        var json = await SendAsync(HttpMethod.Post, $"/api/policies/{policyId}/opinions", body);
        return CivicagoraMethods.ParseId(json);
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
