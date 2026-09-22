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

    /// <summary>광장에서 받아 둔 전체 목록. 걸러내기는 화면에서 한다.</summary>
    private List<PolicySummary> _allPolicies = new();
    private string _search = "";
    private PolicyCategory? _categoryFilter;

    /// <summary>정렬 기준. 웹과 같은 순서로 둔다.</summary>
    private static readonly (string Label, string Key)[] Sorts =
    {
        ("활발한 순", "active"),
        ("균형 필요", "balance"),
        ("최신순", "recent"),
        ("의견 많은 순", "opinions"),
    };

    private static readonly (string Label, string Key)[] Views =
    {
        ("카드", "card"),
        ("목록", "list"),
        ("분류별", "section"),
    };
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

        foreach (var (label, _) in Sorts) SortBox.Items.Add(label);
        SortBox.SelectedIndex = 0;
        foreach (var (label, _) in Views) ViewBox.Items.Add(label);
        ViewBox.SelectedIndex = 0;

        // 엔터로도 검색되게 한다. 버튼까지 가는 동작을 요구하지 않는다.
        SearchBox.KeyDown += (_, e) =>
        {
            if (e.Key == global::Windows.System.VirtualKey.Enter) { _search = SearchBox.Text.Trim(); RenderPlaza(); }
        };

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
            _allPolicies = await _api.ListPoliciesAsync();
            RenderPlaza();
        }
        catch (Exception ex)
        {
            Fail("주제를 불러오지 못했습니다", ex);
        }
        finally { SetBusy(false); }
    }

    // ── 광장 탐색 ──────────────────────────────────────────────────

    private void OnSearch(object sender, RoutedEventArgs e)
    {
        _search = SearchBox.Text.Trim();
        RenderPlaza();
    }

    private void OnClearSearch(object sender, RoutedEventArgs e)
    {
        SearchBox.Text = string.Empty;
        _search = "";
        _categoryFilter = null;
        RenderPlaza();
    }

    private void OnSortOrViewChanged(object sender, SelectionChangedEventArgs e)
    {
        // 생성자에서 항목을 채울 때도 불리므로 준비 전이면 넘어간다.
        if (PolicyList is null) return;
        RenderPlaza();
    }

    /// <summary>
    /// 한쪽으로 기울었는가.
    ///
    /// 웹과 같은 기준을 쓴다(lib/plaza.ts needsBalance). 두 곳이 달라지면
    /// 같은 주제가 기기마다 다르게 표시된다.
    /// </summary>
    private static bool NeedsBalance(PolicySummary s)
    {
        var sides = s.supportCount + s.opposeCount;
        if (sides < 2) return false;
        return Math.Abs((int)s.supportCount - (int)s.opposeCount) / (double)sides >= 0.6;
    }

    private static double BalanceScore(PolicySummary s)
    {
        var sides = s.supportCount + s.opposeCount;
        // 0대0 이나 1대0 은 쏠린 것이 아니라 아직 시작하지 않은 것이다.
        if (sides < 2) return -1;
        return Math.Abs((int)s.supportCount - (int)s.opposeCount) / (double)sides;
    }

    /// <summary>검색·분류·정렬을 적용해 목록을 다시 그린다.</summary>
    private void RenderPlaza()
    {
        var query = _search.Trim();
        IEnumerable<PolicySummary> items = _allPolicies;

        if (query.Length > 0)
        {
            // 제목만 보면 "지역화폐"로 검색했을 때 제목에 그 말이 없는 주제를 놓친다.
            items = items.Where(s =>
                Contains(s.policy.title, query) ||
                Contains(s.policy.coreQuestion, query) ||
                Contains(s.policy.background, query) ||
                Contains(s.policy.targetAgency, query));
        }
        if (_categoryFilter is { } category)
        {
            items = items.Where(s => s.policy.category == category);
        }

        var sortKey = Sorts[Math.Max(0, SortBox.SelectedIndex)].Key;
        items = sortKey switch
        {
            "recent" => items.OrderByDescending(s => s.policy.createdAt),
            "opinions" => items.OrderByDescending(s => s.supportCount + s.alternativeCount + s.opposeCount)
                               .ThenByDescending(s => s.lastActivityAt),
            "balance" => items.OrderByDescending(BalanceScore)
                              .ThenByDescending(s => s.supportCount + s.alternativeCount + s.opposeCount),
            _ => items.OrderByDescending(s => s.lastActivityAt),
        };

        var list = items.ToList();
        var filtered = query.Length > 0 || _categoryFilter is not null;
        PlazaHeader.Text = filtered
            ? $"검색 결과 {list.Count}건"
            : list.Count > 0 ? $"공론 중인 주제 {list.Count}건" : "공론 중인 주제";

        SortHint.Visibility = sortKey == "balance" ? Visibility.Visible : Visibility.Collapsed;
        SortHint.Text = "한쪽으로 기운 주제를 먼저 보여줍니다. 반대편 의견이 가장 필요한 곳입니다.";

        RenderChips();

        PolicyList.Children.Clear();
        if (list.Count == 0)
        {
            PolicyList.Children.Add(Caption(filtered
                ? "조건에 맞는 주제가 없습니다. 검색어를 바꾸거나 분류를 전체로 두고 다시 찾아보세요."
                : "아직 올라온 주제가 없습니다. 공론화하고 싶은 정책이나 현안을 첫 번째로 올려보세요."));
            return;
        }

        var viewKey = Views[Math.Max(0, ViewBox.SelectedIndex)].Key;
        if (viewKey == "section")
        {
            foreach (var group in list.GroupBy(s => s.policy.category))
            {
                PolicyList.Children.Add(SectionHeader($"{CategoryLabel(group.Key)}  {group.Count()}"));
                foreach (var s in group) PolicyList.Children.Add(RenderLine(s));
            }
        }
        else if (viewKey == "list")
        {
            foreach (var s in list) PolicyList.Children.Add(RenderLine(s));
        }
        else
        {
            foreach (var s in list) PolicyList.Children.Add(RenderPolicy(s));
        }
    }

    private static bool Contains(string? haystack, string needle) =>
        haystack is not null && haystack.Contains(needle, StringComparison.OrdinalIgnoreCase);

    private void RenderChips()
    {
        CategoryChips.Children.Clear();
        CategoryChips.Children.Add(Chip("전체", _allPolicies.Count, _categoryFilter is null, () =>
        {
            _categoryFilter = null;
            RenderPlaza();
        }));

        foreach (var (value, label) in Categories)
        {
            var count = _allPolicies.Count(s => s.policy.category == value);
            // 비어 있는 분류는 숨긴다. 고를 수 없는 것을 보여줄 이유가 없다.
            if (count == 0 && _categoryFilter != value) continue;
            var target = value;
            CategoryChips.Children.Add(Chip(label, count, _categoryFilter == target, () =>
            {
                _categoryFilter = target;
                RenderPlaza();
            }));
        }
    }

    private static Button Chip(string label, int count, bool active, Action onClick)
    {
        var button = new Button
        {
            Content = $"{label} {count}",
            Padding = new Thickness(12, 4, 12, 4),
            CornerRadius = new CornerRadius(999),
            FontSize = 13,
        };
        if (active)
        {
            button.Background = new SolidColorBrush(global::Windows.UI.Color.FromArgb(255, 76, 141, 255));
            button.Foreground = new SolidColorBrush(Colors.White);
        }
        button.Click += (_, _) => onClick();
        return button;
    }

    private static UIElement SectionHeader(string text) => new Border
    {
        BorderBrush = (Brush)Application.Current.Resources["CardStrokeColorDefaultBrush"],
        BorderThickness = new Thickness(0, 0, 0, 1),
        Padding = new Thickness(0, 10, 0, 6),
        Margin = new Thickness(0, 6, 0, 2),
        Child = new TextBlock { Text = text, FontWeight = FontWeights.SemiBold },
    };

    /// <summary>목록 보기 — 한 줄로 촘촘하게. 훑을 때는 한 화면에 많이 보이는 편이 낫다.</summary>
    private UIElement RenderLine(PolicySummary s)
    {
        var total = s.supportCount + s.alternativeCount + s.opposeCount;
        var row = new Grid { ColumnSpacing = 10 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(90) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var tag = new Border
        {
            BorderBrush = (Brush)Application.Current.Resources["CardStrokeColorDefaultBrush"],
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(4),
            Padding = new Thickness(6, 1, 6, 1),
            VerticalAlignment = VerticalAlignment.Center,
            Child = Caption(CategoryLabel(s.policy.category)),
        };
        Grid.SetColumn(tag, 0);
        row.Children.Add(tag);

        var title = new TextBlock
        {
            Text = s.policy.title,
            TextTrimming = TextTrimming.CharacterEllipsis,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(title, 1);
        row.Children.Add(title);

        var bar = Distribution(s, total);
        if (bar is FrameworkElement element) element.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn((FrameworkElement)bar, 2);
        row.Children.Add(bar);

        var meta = Caption($"{total}건 · {Ago(s.lastActivityAt)}");
        meta.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(meta, 3);
        row.Children.Add(meta);

        var button = new Button
        {
            Content = row,
            HorizontalAlignment = HorizontalAlignment.Stretch,
            HorizontalContentAlignment = HorizontalAlignment.Stretch,
            Padding = new Thickness(12, 8, 12, 8),
            Background = (Brush)Application.Current.Resources["CardBackgroundFillColorDefaultBrush"],
            BorderBrush = (Brush)Application.Current.Resources["CardStrokeColorDefaultBrush"],
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
        };
        var id = s.policy.id;
        button.Click += (_, _) => { Show(DetailView); _ = LoadDetailAsync(id); };
        return button;
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

        var footer = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        footer.Children.Add(Caption(
            $"찬성 {summary.supportCount} · 대안 {summary.alternativeCount} · 반대 {summary.opposeCount}" +
            (total > 0 ? $" · 의견 {total}건" : "")));
        if (NeedsBalance(summary))
        {
            // 쏠린 주제에 참여를 권한다. 반대편 의견을 데려오는 것이 목적이므로
            // 목록에서부터 그 일을 한다.
            var lacking = summary.supportCount > summary.opposeCount ? "반대" : "찬성";
            footer.Children.Add(new TextBlock
            {
                Text = $"⚖ {lacking} 의견이 필요해요",
                FontSize = 12,
                Foreground = new SolidColorBrush(global::Windows.UI.Color.FromArgb(255, 217, 164, 65)),
            });
        }
        body.Children.Add(footer);

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
            DetailMeta.Text += "   " + SignatureText(CivicagoraMethods.CheckPolicy(p));
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

        var footer = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        // 필명 체계는 VS-C3 에서 붙는다. 그때까지는 식별자 앞부분만 보인다.
        footer.Children.Add(Caption($"작성자 {Shorten(card.authorDid)}"));
        footer.Children.Add(SignatureBadge(CivicagoraMethods.CheckOpinion(card)));
        body.Children.Add(footer);

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

    /// <summary>
    /// 서명 상태 문구 (VS-A4).
    ///
    /// 「검증됨」을 크게 자랑하지 않는다. 서명은 **글이 바뀌지 않았다**는 것만
    /// 말하고, 글이 사실이라는 뜻은 아니다. 대신 검증 실패는 눈에 띄게 한다 —
    /// 그것은 반드시 봐야 하는 신호다.
    /// </summary>
    private static string SignatureText(SignatureStatus status) => status switch
    {
        SignatureStatus.Valid => "✓ 서명 확인",
        SignatureStatus.Unsigned => "서명 없음",
        SignatureStatus.Invalid => "⚠ 서명 불일치",
        _ => "⚠ 서명 형식 오류",
    };

    private static TextBlock SignatureBadge(SignatureStatus status)
    {
        var color = status switch
        {
            SignatureStatus.Valid => global::Windows.UI.Color.FromArgb(255, 75, 158, 127),
            SignatureStatus.Unsigned => global::Windows.UI.Color.FromArgb(255, 138, 143, 152),
            SignatureStatus.Invalid => global::Windows.UI.Color.FromArgb(255, 217, 107, 91),
            _ => global::Windows.UI.Color.FromArgb(255, 217, 164, 65),
        };
        return new TextBlock
        {
            Text = SignatureText(status),
            FontSize = 12,
            Foreground = new SolidColorBrush(color),
        };
    }

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
