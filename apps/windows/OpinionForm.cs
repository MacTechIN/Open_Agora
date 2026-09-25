using System;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using CivicAgora.Core;

namespace CivicAgora.Windows;

/// <summary>
/// 의견 작성 폼 (3단 구조화 입력).
///
/// 입장에 따라 묻는 말이 바뀐다. 찬성하는 사람에게 "무엇이 문제인가"를 묻는
/// 것은 답할 수 없는 질문이다. 저장되는 필드의 의미(논점·근거·제안)와 길이
/// 제한은 고정이고 화면 문구만 바뀐다.
///
/// 명세: docs/00_PRODUCT_SPEC.md §3.1
///
/// 코드로 짓는다. XAML 로 두면 주제 올리기와 의견 쓰기 두 곳에서 같은 것을
/// 두 벌 유지해야 하고, 한쪽만 고치면 질문이 어긋난다.
/// </summary>
public sealed class OpinionForm : UserControl
{
    private const int MaxProblem = 150;
    private const int MaxEvidence = 200;
    private const int MaxSolution = 150;

    private readonly RadioButton _support = new() { Content = "찬성", GroupName = "", IsChecked = true };
    private readonly RadioButton _alternative = new() { Content = "대안 제시", GroupName = "" };
    private readonly RadioButton _oppose = new() { Content = "반대", GroupName = "" };

    private readonly TextBox _problem = Multiline();
    private readonly TextBox _evidence = Multiline();
    private readonly TextBox _url = new() { PlaceholderText = "https://kostat.go.kr/..." };
    private readonly TextBox _solution = Multiline();

    private readonly TextBlock _problemLabel = Strong();
    private readonly TextBlock _solutionLabel = Strong();
    private readonly TextBlock _problemCount = Caption();
    private readonly TextBlock _evidenceCount = Caption();
    private readonly TextBlock _solutionCount = Caption();

    /// <summary>
    /// 톤 스크리닝 안내 (VS-E1).
    ///
    /// 세 본문 칸을 함께 보고 한 줄만 띄운다. 칸마다 띄우면 잔소리가 되고,
    /// 잔소리가 되면 사용자가 읽지 않는다.
    /// </summary>
    private readonly TextBlock _tone = new()
    {
        FontSize = 12,
        TextWrapping = TextWrapping.Wrap,
        Visibility = Visibility.Collapsed,
        Foreground = new SolidColorBrush(global::Windows.UI.Color.FromArgb(255, 217, 164, 65)),
        Text = "거친 표현이 섞여 있을 수 있습니다. 그대로 올리셔도 됩니다 — "
             + "다만 논거가 표현에 가려지면 반대편이 읽지 않습니다.",
    };
    private readonly Button _submit = new() { Content = "등록", HorizontalAlignment = HorizontalAlignment.Stretch };

    /// <summary>등록을 눌렀을 때. 폼이 유효할 때만 불린다.</summary>
    public event Action<DraftCard>? Submitted;

    public OpinionForm(string submitLabel)
    {
        _submit.Content = submitLabel;

        // 라디오 그룹 이름은 인스턴스마다 달라야 한다. 같으면 두 폼이
        // 한 화면에 있을 때 서로의 선택을 지운다.
        var group = "stance-" + Guid.NewGuid().ToString("N")[..8];
        _support.GroupName = _alternative.GroupName = _oppose.GroupName = group;

        foreach (var radio in new[] { _support, _alternative, _oppose })
        {
            radio.Checked += (_, _) => { UpdateQuestions(); Revalidate(); };
        }
        foreach (var box in new[] { _problem, _evidence, _url, _solution })
        {
            box.TextChanged += (_, _) => Revalidate();
        }
        _submit.Click += (_, _) => Submitted?.Invoke(Value());

        var stances = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 16 };
        stances.Children.Add(_support);
        stances.Children.Add(_alternative);
        stances.Children.Add(_oppose);

        var root = new StackPanel { Spacing = 14 };
        root.Children.Add(Strong("어떤 입장이신가요?"));
        root.Children.Add(stances);
        root.Children.Add(Field(_problemLabel, _problemCount, _problem,
            "예) 현행 제도가 모든 업종에 똑같이 적용되어 소상공인에게 과도한 행정 부담을 줍니다."));
        root.Children.Add(Field(Strong("② 어떤 근거가 있나요?"), _evidenceCount, _evidence,
            "예) 통계청 2026년 사업체노동력조사에서 5인 미만 사업장의 행정 부담이 가장 높게 나타났습니다."));

        var urlPanel = new StackPanel();
        urlPanel.Children.Add(Caption("근거 자료의 출처 링크"));
        urlPanel.Children.Add(_url);
        urlPanel.Children.Add(Caption("통계청, 정부 고시, 국회 의안, 학술 논문 같은 1차 자료를 권합니다."));
        root.Children.Add(urlPanel);

        root.Children.Add(Field(_solutionLabel, _solutionCount, _solution,
            "예) 업종별로 기준을 나누고, 소규모 사업장에는 신고 절차를 간소화합니다."));
        root.Children.Add(_tone);
        root.Children.Add(_submit);
        root.Children.Add(Caption("올린 글은 수정하거나 지울 수 없습니다."));

        Content = root;
        UpdateQuestions();
        Revalidate();
    }

    /// <summary>제출 후 비운다. 입장은 유지한다 — 같은 입장으로 연달아 쓰는 경우가 많다.</summary>
    public void Clear()
    {
        _problem.Text = _evidence.Text = _url.Text = _solution.Text = string.Empty;
        Revalidate();
    }

    public void SetBusy(bool busy) => _submit.IsEnabled = !busy && IsReady();

    private StanceType Stance() =>
        _oppose.IsChecked == true ? StanceType.Oppose
        : _alternative.IsChecked == true ? StanceType.Alternative
        : StanceType.Support;

    private DraftCard Value() => new(
        Stance(),
        _problem.Text.Trim(),
        _evidence.Text.Trim(),
        _url.Text.Trim(),
        _solution.Text.Trim());

    private void UpdateQuestions()
    {
        (string problem, string solution) = Stance() switch
        {
            StanceType.Support => ("① 왜 이 방향이 옳다고 보시나요?", "③ 잘 되려면 무엇이 필요할까요?"),
            StanceType.Alternative => ("① 어떤 점이 아쉬운가요?", "③ 어떤 대안을 제안하시나요?"),
            _ => ("① 무엇이 문제인가요?", "③ 대신 어떻게 하면 좋을까요?"),
        };
        _problemLabel.Text = problem;
        _solutionLabel.Text = solution;
    }

    private bool IsReady()
    {
        var problem = Count(_problem.Text);
        var evidence = Count(_evidence.Text);
        var solution = Count(_solution.Text);
        return problem > 0 && problem <= MaxProblem
            && evidence > 0 && evidence <= MaxEvidence
            && solution > 0 && solution <= MaxSolution
            && _url.Text.Trim().Length > 0;
    }

    private void Revalidate()
    {
        Show(_problemCount, Count(_problem.Text), MaxProblem);
        Show(_evidenceCount, Count(_evidence.Text), MaxEvidence);
        Show(_solutionCount, Count(_solution.Text), MaxSolution);
        ShowTone();
        _submit.IsEnabled = IsReady();
    }

    /// <summary>
    /// 톤 스크리닝 (VS-E1).
    ///
    /// **기기 안에서만 돈다.** 코어를 부를 뿐 네트워크를 쓰지 않는다 —
    /// 쓰다 만 말은 쓴 말보다 사람을 더 많이 드러낸다.
    ///
    /// 점수도 걸린 표현도 보여주지 않는다. 점수를 보여주면 점수를 낮추는
    /// 글쓰기를 하게 되고, 걸린 표현을 보여주면 그것을 피해 쓰는 법을 알려
    /// 주는 셈이 된다.
    ///
    /// **막지 않는다.** 등록 버튼은 그대로다.
    /// </summary>
    private void ShowTone()
    {
        var text = $"{_problem.Text}\n{_evidence.Text}\n{_solution.Text}";
        bool flagged;
        try
        {
            flagged = CivicagoraMethods.Screen(text).needsReview;
        }
        catch
        {
            // 스크리닝이 실패해도 글쓰기를 막지 않는다. 코치가 고장 났다고
            // 사용자가 글을 못 쓸 이유는 없다.
            flagged = false;
        }
        _tone.Visibility = flagged ? Visibility.Visible : Visibility.Collapsed;
    }

    /// <summary>글자 수는 코어와 같은 기준으로 센다. 따로 세면 기준이 갈린다.</summary>
    private static int Count(string? text) =>
        string.IsNullOrEmpty(text) ? 0 : (int)CivicagoraMethods.GraphemeCount(text.Trim());

    private static void Show(TextBlock target, int count, int limit)
    {
        var over = count > limit;
        // 한도만 보여주면 얼마나 줄여야 할지 알 수 없다.
        target.Text = over ? $"{count} / {limit}자 — {count - limit}자 초과" : $"{count} / {limit}자";
        target.Foreground = new SolidColorBrush(over ? Colors.Crimson : Colors.Gray);
    }

    private static StackPanel Field(TextBlock label, TextBlock count, TextBox box, string placeholder)
    {
        box.PlaceholderText = placeholder;
        var head = new Grid();
        head.Children.Add(label);
        count.HorizontalAlignment = HorizontalAlignment.Right;
        head.Children.Add(count);

        var panel = new StackPanel();
        panel.Children.Add(head);
        panel.Children.Add(box);
        return panel;
    }

    private static TextBox Multiline() => new()
    {
        TextWrapping = TextWrapping.Wrap,
        AcceptsReturn = true,
        Height = 72,
    };

    private static TextBlock Strong(string text = "") => new()
    {
        Text = text,
        FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
        TextWrapping = TextWrapping.Wrap,
    };

    private static TextBlock Caption(string text = "") => new()
    {
        Text = text,
        FontSize = 12,
        TextWrapping = TextWrapping.Wrap,
        Foreground = new SolidColorBrush(Colors.Gray),
    };
}
