using System;
using System.Collections.Generic;
using System.IO;
using Microsoft.UI;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using CivicAgora.Core;

namespace CivicAgora.Windows;

/// <summary>
/// VS-A3 — 로컬 카드 작성과 조회.
///
/// 이 단계의 스텁: P2P 전파 없음(로컬 SQLite만), 서명 없음, 톤 코칭 없음.
/// 각각 VS-B1, VS-A4, VS-E1에서 붙는다.
///
/// 목록은 XAML 데이터 템플릿 대신 코드에서 구성한다. 항목 수가 적고, 3열
/// 배치(VS-D1)에서 레이아웃이 크게 바뀔 예정이므로 템플릿을 미리 굳히지 않는다.
///
/// 작업 단위: docs/09_DEVELOPMENT_PLAN.md VS-A3
/// </summary>
public sealed partial class MainWindow : Window
{
    /// <summary>필드별 한도. 코어 상수와 같아야 한다.</summary>
    private const int MaxProblem = 150;
    private const int MaxEvidence = 200;
    private const int MaxSolution = 150;

    private CardStore? _store;
    private string? _authorDid;

    public MainWindow()
    {
        StartupLog.Write("MainWindow InitializeComponent 시작");
        InitializeComponent();
        StartupLog.Write("MainWindow InitializeComponent 완료");

        ShowCore();
        ShowIdentity();
        OpenStore();

        // 글자 수를 코어와 같은 기준으로 센다. UI가 따로 세면 한글 분해나
        // 이모지 조합에서 기준이 갈려, 화면은 149자인데 제출이 거부된다.
        ProblemBox.TextChanged += (_, _) => Revalidate();
        EvidenceBox.TextChanged += (_, _) => Revalidate();
        SolutionBox.TextChanged += (_, _) => Revalidate();
        UrlBox.TextChanged += (_, _) => Revalidate();
        Revalidate();
    }

    private void ShowCore()
    {
        try
        {
            StartupLog.Write("코어 호출 시도");
            var info = CivicagoraMethods.CoreInfo();
            StartupLog.Write("코어 호출 성공", info.version);
            CoreText.Text = $"{info.version} · 명세 rev {info.specRevision} · " +
                            $"{info.target} · {(info.debug ? "debug" : "release")}";
        }
        catch (Exception ex)
        {
            StartupLog.WriteException("코어 호출", ex);
            CoreText.Text = $"코어를 불러오지 못했습니다 — {ex.GetType().Name}: {ex.Message}";
        }
    }

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
                ? "하드웨어 (TPM)"
                : "소프트웨어 KSP — 내보내기 차단";
        }
        catch (Exception ex)
        {
            StartupLog.WriteException("신원 생성", ex);
            DidText.Text = "신원 생성 실패";
            ProtectionText.Text = ex.Message;
        }
    }

    private void OpenStore()
    {
        try
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "CivicAgora");
            Directory.CreateDirectory(dir);
            _store = new CardStore(Path.Combine(dir, "cards.db"));
            StartupLog.Write("저장소 열기 성공", dir);
            Reload();
        }
        catch (Exception ex)
        {
            StartupLog.WriteException("저장소 열기", ex);
            ErrorText.Text = $"저장소를 열지 못했습니다 — {ex.GetType().Name}: {ex.Message}";
        }
    }

    /// <summary>글자 수를 갱신하고 제출 가능 여부를 판정한다.</summary>
    private void Revalidate()
    {
        var problem = Count(ProblemBox.Text);
        var evidence = Count(EvidenceBox.Text);
        var solution = Count(SolutionBox.Text);

        Show(ProblemCount, problem, MaxProblem);
        Show(EvidenceCount, evidence, MaxEvidence);
        Show(SolutionCount, solution, MaxSolution);

        // 한도를 넘으면 버튼을 막는다. 코어가 다시 검증하지만, 넘긴 뒤에
        // 거부당하는 것보다 미리 막는 편이 낫다.
        SubmitButton.IsEnabled =
            _store is not null && _authorDid is not null &&
            problem > 0 && problem <= MaxProblem &&
            evidence > 0 && evidence <= MaxEvidence &&
            solution > 0 && solution <= MaxSolution &&
            !string.IsNullOrWhiteSpace(UrlBox.Text);
    }

    private static int Count(string? text) =>
        string.IsNullOrEmpty(text) ? 0 : (int)CivicagoraMethods.GraphemeCount(text.Trim());

    private static void Show(TextBlock target, int count, int limit)
    {
        var over = count > limit;
        // 넘긴 만큼을 알려준다. 한도만 보여주면 얼마나 줄여야 할지 알 수 없다.
        target.Text = over ? $"{count} / {limit}자 — {count - limit}자 초과" : $"{count} / {limit}자";
        target.Foreground = new SolidColorBrush(over ? Colors.Crimson : Colors.Gray);
    }

    private void OnSubmit(object sender, RoutedEventArgs e)
    {
        if (_store is null || _authorDid is null) return;

        var draft = new DraftCard(
            SelectedStance(),
            ProblemBox.Text.Trim(),
            EvidenceBox.Text.Trim(),
            UrlBox.Text.Trim(),
            SolutionBox.Text.Trim());

        try
        {
            _store.Add(draft, _authorDid, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            ErrorText.Text = string.Empty;
            // 제출 후 초기화. 스탠스는 유지한다 — 같은 입장으로 연달아 쓰는
            // 경우가 많다.
            ProblemBox.Text = EvidenceBox.Text = UrlBox.Text = SolutionBox.Text = string.Empty;
            Reload();
        }
        catch (Exception ex)
        {
            // 검증 실패 이유를 그대로 보여준다. 코어가 어느 필드가 몇 자
            // 넘었는지까지 알려주므로 가공하지 않는다.
            ErrorText.Text = ex.Message;
        }
    }

    private StanceType SelectedStance()
    {
        if (StanceOppose.IsChecked == true) return StanceType.Oppose;
        if (StanceAlternative.IsChecked == true) return StanceType.Alternative;
        return StanceType.Support;
    }

    private void Reload()
    {
        if (_store is null) return;
        try
        {
            var cards = _store.List();
            ListHeader.Text = $"등록된 의견 {cards.Count}건";
            CardsPanel.Children.Clear();
            if (cards.Count == 0)
            {
                CardsPanel.Children.Add(Caption("아직 등록된 의견이 없습니다."));
                return;
            }
            foreach (var card in cards)
            {
                CardsPanel.Children.Add(Render(card));
            }
        }
        catch (Exception ex)
        {
            ErrorText.Text = $"목록을 읽지 못했습니다 — {ex.Message}";
        }
    }

    private static UIElement Render(DebateCard card)
    {
        var body = new StackPanel { Spacing = 6 };

        var header = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        header.Children.Add(Badge(card.stance));
        header.Children.Add(Caption(
            DateTimeOffset.FromUnixTimeMilliseconds(card.createdAt).LocalDateTime
                .ToString("MM-dd HH:mm")));
        body.Children.Add(header);

        body.Children.Add(Section("문제 정의", card.problemDefinition));
        body.Children.Add(Section("근거", card.evidenceSource));
        body.Children.Add(new TextBlock
        {
            Text = card.evidenceUrl,
            FontSize = 12,
            TextWrapping = TextWrapping.Wrap,
            Foreground = new SolidColorBrush(Colors.SteelBlue),
        });
        body.Children.Add(Section("해결책", card.actionableSolution));
        // 필명 체계는 VS-C3에서 붙는다. 그때까지는 DID 앞부분만 보인다.
        body.Children.Add(Caption($"작성자 {Shorten(card.authorDid)}"));

        return new Border
        {
            Background = (Brush)Application.Current.Resources["CardBackgroundFillColorDefaultBrush"],
            BorderBrush = (Brush)Application.Current.Resources["CardStrokeColorDefaultBrush"],
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(14),
            Child = body,
        };
    }

    private static UIElement Badge(StanceType stance)
    {
        var (label, color) = stance switch
        {
            // 좌우 어느 쪽도 우대하지 않도록 채도를 맞춘다.
            StanceType.Support => ("찬성", Windows.UI.Color.FromArgb(255, 46, 125, 111)),
            StanceType.Alternative => ("대안", Windows.UI.Color.FromArgb(255, 106, 90, 205)),
            _ => ("반대", Windows.UI.Color.FromArgb(255, 158, 91, 74)),
        };
        return new Border
        {
            Background = new SolidColorBrush(color),
            CornerRadius = new CornerRadius(4),
            Padding = new Thickness(8, 2, 8, 2),
            Child = new TextBlock
            {
                Text = label,
                FontSize = 12,
                FontWeight = FontWeights.Bold,
                Foreground = new SolidColorBrush(Colors.White),
            },
        };
    }

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

    private static string Shorten(string did) =>
        did.Length <= 26 ? did : did[..26] + "…";
}
