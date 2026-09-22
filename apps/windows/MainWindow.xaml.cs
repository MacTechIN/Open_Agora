using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Microsoft.UI;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using CivicAgora.Core;

namespace CivicAgora.Windows;

/// <summary>
/// 공론장 창.
///
/// 광장 → 주제 상세 → 의견 순으로 이동한다. 주제 없이 의견만 받는 것은
/// 말이 되지 않는다 — 찬반은 주제가 아니라 **쟁점 질문**에 대한 것이다.
///
/// 명세: docs/14_USER_JOURNEY.md
/// </summary>
public sealed partial class MainWindow : Window
{
    private readonly ApiClient _api = new();
    private string? _authorDid;
    private string? _currentPolicyId;
    private OpinionForm? _detailForm;
    private OpinionForm? _newTopicForm;

    /// <summary>분류 표시 이름. 코어 열거값과 순서를 맞춘다.</summary>
    private static readonly (PolicyCategory Value, string Label)[] Categories =
    {
        (PolicyCategory.GovPolicy, "정부정책"),
        (PolicyCategory.Legislation, "입법안"),
        (PolicyCategory.PartyPolicy, "정당정책"),
        (PolicyCategory.Local, "지자체"),
        (PolicyCategory.PublicOrg, "공공기관"),
        (PolicyCategory.SocialIssue, "사회현안"),
        (PolicyCategory.Whistleblow, "문제고발"),
    };

    public MainWindow()
    {
        StartupLog.Write("MainWindow InitializeComponent 시작");
        InitializeComponent();
        StartupLog.Write("MainWindow InitializeComponent 완료");

        try { AppWindow.Resize(new global::Windows.Graphics.SizeInt32(1180, 1000)); }
        catch { /* 창 크기 지정 실패가 실행을 막아서는 안 된다 */ }

        foreach (var (_, label) in Categories) CategoryBox.Items.Add(label);
        CategoryBox.SelectedIndex = 0;

        foreach (var box in new[] { TitleBox, BackgroundBox, QuestionBox, SourceBox })
        {
            box.TextChanged += (_, _) => RevalidateTopic();
        }

        _detailForm = new OpinionForm("의견 등록하기");
        _detailForm.Submitted += draft => _ = SubmitOpinionAsync(draft);
        OpinionFormHost.Content = _detailForm;

        _newTopicForm = new OpinionForm("주제 올리기");
        _newTopicForm.Submitted += draft => _ = SubmitTopicAsync(draft);
        NewTopicFormHost.Content = _newTopicForm;

        ShowIdentity();
        ShowCore();
        RevalidateTopic();
        _ = LoadPlazaAsync();
    }

    // ── 화면 전환 ──────────────────────────────────────────────────

    private void Show(StackPanel view)
    {
        foreach (var panel in new[] { PlazaView, DetailView, NewTopicView, MemberView })
        {
            panel.Visibility = ReferenceEquals(panel, view) ? Visibility.Visible : Visibility.Collapsed;
        }
        Notice.IsOpen = false;
    }

    private void OnGoPlaza(object sender, RoutedEventArgs e) { Show(PlazaView); _ = LoadPlazaAsync(); }
    private void OnGoNewTopic(object sender, RoutedEventArgs e) => Show(NewTopicView);
    private void OnGoMember(object sender, RoutedEventArgs e) => Show(MemberView);

    private void OnRefresh(object sender, RoutedEventArgs e)
    {
        if (DetailView.Visibility == Visibility.Visible && _currentPolicyId is not null)
        {
            _ = LoadDetailAsync(_currentPolicyId);
        }
        else
        {
            _ = LoadPlazaAsync();
        }
    }

    // ── 광장 ───────────────────────────────────────────────────────

    private async Task LoadPlazaAsync()
    {
        SetBusy(true);
        try
        {
            var policies = await _api.ListPoliciesAsync();
            PlazaHeader.Text = policies.Count == 0
                ? "공론 중인 주제"
                : $"공론 중인 주제 {policies.Count}건";

            PolicyList.Children.Clear();
            if (policies.Count == 0)
            {
                PolicyList.Children.Add(Caption(
                    "아직 올라온 주제가 없습니다. 공론화하고 싶은 정책이나 현안을 첫 번째로 올려보세요."));
                return;
            }
            foreach (var summary in policies) PolicyList.Children.Add(RenderPolicy(summary));
        }
        catch (Exception ex)
        {
            Fail("주제를 불러오지 못했습니다", ex);
        }
        finally { SetBusy(false); }
    }

    private UIElement RenderPolicy(PolicySummary summary)
    {
        var p = summary.policy;
        var total = summary.supportCount + summary.alternativeCount + summary.opposeCount;

        var body = new StackPanel { Spacing = 8 };

        var head = new Grid();
        head.Children.Add(new TextBlock
        {
            Text = p.title,
            FontSize = 17,
            FontWeight = FontWeights.SemiBold,
            TextWrapping = TextWrapping.Wrap,
        });
        head.Children.Add(new TextBlock
        {
            Text = Ago(summary.lastActivityAt),
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Top,
            FontSize = 12,
            Foreground = new SolidColorBrush(Colors.Gray),
        });
        body.Children.Add(head);

        var meta = CategoryLabel(p.category) + (string.IsNullOrEmpty(p.targetAgency) ? "" : $" · {p.targetAgency}");
        body.Children.Add(Caption(meta));
        body.Children.Add(new TextBlock { Text = p.coreQuestion, TextWrapping = TextWrapping.Wrap });
        body.Children.Add(Distribution(summary, total));
        body.Children.Add(Caption(
            $"찬성 {summary.supportCount} · 대안 {summary.alternativeCount} · 반대 {summary.opposeCount}" +
            (total > 0 ? $" · 의견 {total}건" : "")));

        var button = new Button
        {
            Content = body,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Padding = new Thickness(16),
            Background = (Brush)Application.Current.Resources["CardBackgroundFillColorDefaultBrush"],
            BorderBrush = (Brush)Application.Current.Resources["CardStrokeColorDefaultBrush"],
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
        };
        button.Click += (_, _) => { Show(DetailView); _ = LoadDetailAsync(p.id); };
        return button;
    }

    /// <summary>찬반 분포 막대. 가운데가 대안이다.</summary>
    private static UIElement Distribution(PolicySummary s, uint total)
    {
        var bar = new Grid { Height = 8, CornerRadius = new CornerRadius(4), MinWidth = 200 };
        if (total == 0)
        {
            bar.Background = new SolidColorBrush(global::Windows.UI.Color.FromArgb(255, 34, 38, 47));
            return bar;
        }
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(s.supportCount, GridUnitType.Star) });
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(s.alternativeCount, GridUnitType.Star) });
        bar.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(s.opposeCount, GridUnitType.Star) });

        for (var i = 0; i < 3; i++)
        {
            var fill = new Border { Background = new SolidColorBrush(StanceColor((StanceType)i)) };
            Grid.SetColumn(fill, i);
            bar.Children.Add(fill);
        }
        return bar;
    }

    // ── 주제 상세 ──────────────────────────────────────────────────

    private async Task LoadDetailAsync(string policyId)
    {
        _currentPolicyId = policyId;
        SetBusy(true);
        try
        {
            var policies = await _api.ListPoliciesAsync();
            var summary = policies.FirstOrDefault(s => s.policy.id == policyId);
            if (summary is null) { Notice.Title = "주제를 찾지 못했습니다"; Notice.IsOpen = true; return; }

            var p = summary.policy;
            DetailTitle.Text = p.title;
            DetailMeta.Text = CategoryLabel(p.category) +
                              (string.IsNullOrEmpty(p.targetAgency) ? "" : $" · {p.targetAgency}");
            DetailQuestion.Text = p.coreQuestion;
            DetailBackground.Text = p.background;
            OpinionQuestion.Text = p.coreQuestion;

            var opinions = await _api.ListOpinionsAsync(policyId);
            OpinionHeader.Text = $"의견 {opinions.Count}건";

            Fill(SupportColumn, "찬성", StanceType.Support, opinions);
            Fill(AlternativeColumn, "대안 · 합의", StanceType.Alternative, opinions);
            Fill(OpposeColumn, "반대", StanceType.Oppose, opinions);
        }
        catch (Exception ex)
        {
            Fail("주제를 불러오지 못했습니다", ex);
        }
        finally { SetBusy(false); }
    }

    private static void Fill(StackPanel column, string label, StanceType stance, List<DebateCard> all)
    {
        var mine = all.Where(c => c.stance == stance).ToList();
        column.Children.Clear();

        column.Children.Add(new Border
        {
            Background = new SolidColorBrush(StanceColor(stance)),
            CornerRadius = new CornerRadius(6),
            Padding = new Thickness(6),
            Child = new TextBlock
            {
                Text = $"{label} {mine.Count}",
                HorizontalAlignment = HorizontalAlignment.Center,
                Foreground = new SolidColorBrush(Colors.White),
                FontWeight = FontWeights.SemiBold,
            },
        });

        if (mine.Count == 0)
        {
            column.Children.Add(Caption("아직 없습니다"));
            return;
        }
        foreach (var card in mine) column.Children.Add(RenderOpinion(card));
    }

    private static UIElement RenderOpinion(DebateCard card)
    {
        var body = new StackPanel { Spacing = 6 };
        body.Children.Add(Section("논점", card.problemDefinition));
        body.Children.Add(Section("근거", card.evidenceSource));
        body.Children.Add(new TextBlock
        {
            Text = card.evidenceUrl,
            FontSize = 11,
            TextWrapping = TextWrapping.Wrap,
            Foreground = new SolidColorBrush(Colors.SteelBlue),
        });
        body.Children.Add(Section("제안", card.actionableSolution));
        // 필명 체계는 VS-C3 에서 붙는다. 그때까지는 식별자 앞부분만 보인다.
        body.Children.Add(Caption($"작성자 {Shorten(card.authorDid)}"));

        return new Border
        {
            Background = (Brush)Application.Current.Resources["CardBackgroundFillColorDefaultBrush"],
            BorderBrush = (Brush)Application.Current.Resources["CardStrokeColorDefaultBrush"],
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(12),
            Child = body,
        };
    }

    private async Task SubmitOpinionAsync(DraftCard draft)
    {
        if (_currentPolicyId is null || !RequireIdentity()) return;
        SetBusy(true);
        _detailForm?.SetBusy(true);
        try
        {
            await _api.AddOpinionAsync(_currentPolicyId, draft, _authorDid!);
            _detailForm?.Clear();
            await LoadDetailAsync(_currentPolicyId);
        }
        catch (Exception ex)
        {
            Fail("의견을 올리지 못했습니다", ex);
        }
        finally { SetBusy(false); _detailForm?.SetBusy(false); }
    }

    // ── 주제 올리기 ────────────────────────────────────────────────

    private void RevalidateTopic()
    {
        ShowCount(TitleCount, TitleBox.Text, 60);
        ShowCount(BackgroundCount, BackgroundBox.Text, 300);
        ShowCount(QuestionCount, QuestionBox.Text, 100);
    }

    private async Task SubmitTopicAsync(DraftCard firstOpinion)
    {
        if (!RequireIdentity()) return;

        var category = Categories[Math.Max(0, CategoryBox.SelectedIndex)].Value;
        var policy = new DraftPolicy(
            TitleBox.Text.Trim(),
            category,
            BackgroundBox.Text.Trim(),
            QuestionBox.Text.Trim(),
            SourceBox.Text.Trim(),
            string.IsNullOrWhiteSpace(AgencyBox.Text) ? null : AgencyBox.Text.Trim());

        SetBusy(true);
        _newTopicForm?.SetBusy(true);
        try
        {
            var id = await _api.OpenPolicyAsync(policy, firstOpinion, _authorDid!);
            TitleBox.Text = BackgroundBox.Text = QuestionBox.Text = SourceBox.Text = AgencyBox.Text = string.Empty;
            _newTopicForm?.Clear();
            Show(DetailView);
            await LoadDetailAsync(id);
        }
        catch (Exception ex)
        {
            Fail("주제를 올리지 못했습니다", ex);
        }
        finally { SetBusy(false); _newTopicForm?.SetBusy(false); }
    }

    // ── 시민 인증 ──────────────────────────────────────────────────

    private async void OnRequestCode(object sender, RoutedEventArgs e)
    {
        SetBusy(true);
        try
        {
            await _api.RequestCodeAsync(EmailBox.Text.Trim());
            CodePanel.Visibility = Visibility.Visible;
            MemberStatus.Text = "인증코드를 보냈습니다. 메일함을 확인해 주세요.";
        }
        catch (Exception ex) { Fail("인증코드를 보내지 못했습니다", ex); }
        finally { SetBusy(false); }
    }

    private async void OnVerify(object sender, RoutedEventArgs e)
    {
        if (!RequireIdentity()) return;
        SetBusy(true);
        try
        {
            await _api.VerifyAsync(EmailBox.Text.Trim(), CodeBox.Text.Trim(), _authorDid!);
            MemberStatus.Text = "인증이 끝났습니다. 이제 글을 쓸 수 있습니다.";
            CodePanel.Visibility = Visibility.Collapsed;
        }
        catch (Exception ex) { Fail("인증에 실패했습니다", ex); }
        finally { SetBusy(false); }
    }

    private bool RequireIdentity()
    {
        if (_authorDid is not null) return true;
        Notice.Title = "시민 ID를 만들지 못했습니다";
        Notice.Message = "글을 쓰려면 시민 ID가 필요합니다. 「시민 인증」에서 확인해 주세요.";
        Notice.Severity = InfoBarSeverity.Error;
        Notice.IsOpen = true;
        return false;
    }

    // ── 신원·코어 정보 ─────────────────────────────────────────────

    private void ShowIdentity()
    {
        try
        {
            StartupLog.Write("신원 생성 시도");
            var identity = DeviceIdentity.LoadOrCreate();
            StartupLog.Write("신원 생성 성공");
            _authorDid = identity.Did;
            DidText.Text = identity.Did;
            ProtectionText.Text = identity.Protection == DeviceIdentity.Protection.Hardware
                ? "이 컴퓨터의 보안 칩(TPM)에 보관 — 가장 안전합니다"
                : "Windows 보안 저장소에 보관 — 꺼내갈 수 없습니다";
        }
        catch (Exception ex)
        {
            StartupLog.WriteException("신원 생성", ex);
            DidText.Text = "만들지 못했습니다";
            ProtectionText.Text = ex.Message;
        }
    }

    private void ShowCore()
    {
        try
        {
            var info = CivicagoraMethods.CoreInfo();
            CoreText.Text = $"CivicAgora {info.version} (Windows 64비트)";
        }
        catch (Exception ex)
        {
            StartupLog.WriteException("코어 호출", ex);
            CoreText.Text = "프로그램 구성 요소를 불러오지 못했습니다.";
        }
    }

    // ── 도우미 ─────────────────────────────────────────────────────

    private void SetBusy(bool busy) =>
        Busy.Visibility = busy ? Visibility.Visible : Visibility.Collapsed;

    /// <summary>
    /// 오류를 알린다.
    ///
    /// 서버가 보낸 안내("논점이 150자를 넘습니다")는 그대로 보여준다.
    /// 사용자가 고칠 수 있는 내용이므로 가공하지 않는다.
    /// </summary>
    private void Fail(string title, Exception ex)
    {
        Notice.Title = title;
        Notice.Message = ex.Message;
        Notice.Severity = InfoBarSeverity.Error;
        Notice.IsOpen = true;
    }

    private static void ShowCount(TextBlock target, string? text, int limit)
    {
        var count = string.IsNullOrEmpty(text) ? 0 : (int)CivicagoraMethods.GraphemeCount(text.Trim());
        var over = count > limit;
        target.Text = over ? $"{count} / {limit}자 — {count - limit}자 초과" : $"{count} / {limit}자";
        target.Foreground = new SolidColorBrush(over ? Colors.Crimson : Colors.Gray);
    }

    private static string CategoryLabel(PolicyCategory category) =>
        Categories.FirstOrDefault(c => c.Value == category).Label ?? "기타";

    /// <summary>좌우 어느 쪽도 우대하지 않도록 채도를 맞춘다.</summary>
    private static global::Windows.UI.Color StanceColor(StanceType stance) => stance switch
    {
        StanceType.Support => global::Windows.UI.Color.FromArgb(255, 46, 125, 111),
        StanceType.Alternative => global::Windows.UI.Color.FromArgb(255, 106, 90, 205),
        _ => global::Windows.UI.Color.FromArgb(255, 158, 91, 74),
    };

    private static UIElement Section(string label, string value)
    {
        var panel = new StackPanel();
        panel.Children.Add(Caption(label));
        panel.Children.Add(new TextBlock { Text = value, TextWrapping = TextWrapping.Wrap });
        return panel;
    }

    private static TextBlock Caption(string text) => new()
    {
        Text = text,
        FontSize = 12,
        TextWrapping = TextWrapping.Wrap,
        Foreground = new SolidColorBrush(Colors.Gray),
    };

    private static string Shorten(string did) => did.Length <= 24 ? did : did[..24] + "…";

    private static string Ago(long epochMillis)
    {
        var minutes = (DateTimeOffset.UtcNow - DateTimeOffset.FromUnixTimeMilliseconds(epochMillis)).TotalMinutes;
        if (minutes < 1) return "방금";
        if (minutes < 60) return $"{(int)minutes}분 전";
        if (minutes < 1440) return $"{(int)(minutes / 60)}시간 전";
        return $"{(int)(minutes / 1440)}일 전";
    }
}
