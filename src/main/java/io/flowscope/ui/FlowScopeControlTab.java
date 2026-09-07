package io.flowscope.ui;

import io.flowscope.core.Pipeline;
import io.flowscope.core.Source;

import javax.swing.BorderFactory;
import javax.swing.JButton;
import javax.swing.JFileChooser;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTextArea;
import javax.swing.SwingUtilities;
import javax.swing.filechooser.FileNameExtensionFilter;
import java.awt.BorderLayout;
import java.awt.Desktop;
import java.awt.FlowLayout;
import java.awt.Font;
import java.awt.GridLayout;
import java.io.File;
import java.net.URI;

/** Burp 안에는 상태·설정만 두고 실제 분석 작업면은 동일한 localhost Web UI로 연다. */
public final class FlowScopeControlTab extends JPanel {
    public interface Actions {
        void importProxyHistory();
        void loadSample();
        void clearTraffic();
        void saveProject(File file);
        void loadProject(File file);
        void updateScope(String value);
    }

    private final Actions actions;
    private final String webUrl;
    private final JTextArea scope = new JTextArea(6, 56);
    private final JLabel collection = new JLabel("관측 0건 · HUMAN 0 · SCANNER 0 · LLM 0");
    public FlowScopeControlTab(Actions actions, String webUrl, String portMapping) {
        super(new BorderLayout(14, 14));
        this.actions = actions;
        this.webUrl = webUrl;
        setBorder(BorderFactory.createEmptyBorder(18, 18, 18, 18));
        add(header(), BorderLayout.NORTH);
        add(content(portMapping), BorderLayout.CENTER);
        add(collection, BorderLayout.SOUTH);
    }

    public void setScopeText(String value) { scope.setText(value == null ? "" : value); }

    public void render(Pipeline.Result result) {
        long human = result.records.stream().filter(record -> record.source == Source.HUMAN).count();
        long scanner = result.records.stream().filter(record -> record.source == Source.SCANNER).count();
        long llm = result.records.stream().filter(record -> record.source == Source.LLM).count();
        SwingUtilities.invokeLater(() -> collection.setText("수집 " + result.records.size() + "건 · 분석 "
                + result.coverageRecords.size() + " · 기본 숨김 " + result.excludedCount + " · 검토 "
                + result.reviewCount + " · HUMAN "
                + human + " · SCANNER " + scanner + " · LLM " + llm + " · 후보 "
                + result.analysis.findings().size() + " · 갭 " + result.analysis.gaps().size()));
    }

    private JPanel header() {
        JPanel panel = new JPanel(new BorderLayout(12, 6));
        JLabel title = new JLabel("FlowScope · Burp Traffic Control");
        title.setFont(title.getFont().deriveFont(Font.BOLD, 21f));
        JLabel detail = new JLabel("그래프·매트릭스·요청/응답 분석은 동일한 로컬 Web UI에서 제공합니다: " + webUrl);
        JPanel labels = new JPanel(new GridLayout(2, 1, 0, 4));
        labels.add(title);
        labels.add(detail);
        panel.add(labels, BorderLayout.CENTER);
        JButton open = new JButton("FlowScope Web UI 열기");
        open.setName("web.open");
        open.addActionListener(ignored -> openWeb());
        panel.add(open, BorderLayout.EAST);
        return panel;
    }

    private JPanel content(String portMapping) {
        JPanel root = new JPanel(new BorderLayout(0, 12));
        JPanel settings = new JPanel(new BorderLayout(8, 8));
        settings.setBorder(BorderFactory.createTitledBorder("진단 범위 · 세 소스 연결"));
        scope.setLineWrap(true);
        scope.setWrapStyleWord(false);
        scope.setName("scope.input");
        settings.add(new JScrollPane(scope), BorderLayout.CENTER);
        JLabel help = new JLabel("한 줄에 하나의 http(s)://host[:port]/path-prefix · 빈 범위는 대상 요청·수집 차단 · 포트 분류: " + portMapping);
        settings.add(help, BorderLayout.NORTH);
        JButton apply = new JButton("범위 적용");
        apply.setName("scope.apply");
        apply.addActionListener(ignored -> actions.updateScope(scope.getText()));
        settings.add(apply, BorderLayout.EAST);

        JPanel actionsPanel = new JPanel(new FlowLayout(FlowLayout.LEFT, 8, 0));
        actionsPanel.setBorder(BorderFactory.createTitledBorder("프로젝트"));
        actionsPanel.add(button("Proxy History 가져오기", actions::importProxyHistory));
        actionsPanel.add(button("샘플 프로젝트", actions::loadSample));
        actionsPanel.add(button("프로젝트 열기", this::chooseLoad));
        actionsPanel.add(button("로컬 DB 저장·연결", this::chooseSave));
        actionsPanel.add(button("JSON 내보내기", this::chooseJsonExport));
        actionsPanel.add(button("수집 초기화", this::confirmClear));
        root.add(settings, BorderLayout.NORTH);
        root.add(actionsPanel, BorderLayout.CENTER);
        return root;
    }

    private static JButton button(String label, Runnable action) {
        JButton button = new JButton(label);
        button.addActionListener(ignored -> action.run());
        return button;
    }

    private void chooseLoad() {
        JFileChooser chooser = projectChooser();
        if (chooser.showOpenDialog(this) == JFileChooser.APPROVE_OPTION) actions.loadProject(chooser.getSelectedFile());
    }

    private void chooseSave() {
        JFileChooser chooser = new JFileChooser();
        chooser.setAcceptAllFileFilterUsed(false);
        chooser.setFileFilter(new FileNameExtensionFilter("FlowScope local database (*.flowscope.db)", "db"));
        if (chooser.showSaveDialog(this) != JFileChooser.APPROVE_OPTION) return;
        File selected = chooser.getSelectedFile();
        if (!selected.getName().endsWith(".flowscope.db")) {
            selected = new File(selected.getParentFile(), selected.getName() + ".flowscope.db");
        }
        actions.saveProject(selected);
    }

    private void chooseJsonExport() {
        JFileChooser chooser = new JFileChooser();
        chooser.setAcceptAllFileFilterUsed(false);
        chooser.setFileFilter(new FileNameExtensionFilter("FlowScope interchange JSON (*.flowscope.json)", "json"));
        if (chooser.showSaveDialog(this) != JFileChooser.APPROVE_OPTION) return;
        File selected = chooser.getSelectedFile();
        if (!selected.getName().endsWith(".flowscope.json")) {
            selected = new File(selected.getParentFile(), selected.getName() + ".flowscope.json");
        }
        actions.saveProject(selected);
    }

    private static JFileChooser projectChooser() {
        JFileChooser chooser = new JFileChooser();
        chooser.setAcceptAllFileFilterUsed(false);
        chooser.addChoosableFileFilter(new FileNameExtensionFilter(
                "FlowScope interchange JSON (*.flowscope.json)", "json"));
        chooser.setFileFilter(new FileNameExtensionFilter(
                "FlowScope local database (*.flowscope.db)", "db"));
        return chooser;
    }

    private void confirmClear() {
        if (JOptionPane.showConfirmDialog(this, "수집 트래픽과 검토 판정을 초기화할까요? 계정·세션 연결은 유지됩니다.",
                "FlowScope", JOptionPane.YES_NO_OPTION, JOptionPane.WARNING_MESSAGE) == JOptionPane.YES_OPTION) {
            actions.clearTraffic();
        }
    }

    private void openWeb() {
        try {
            if (!Desktop.isDesktopSupported()) throw new IllegalStateException("Desktop browse unavailable");
            Desktop.getDesktop().browse(URI.create(webUrl));
        } catch (Exception error) {
            JOptionPane.showMessageDialog(this, webUrl, "브라우저에서 이 주소를 여세요", JOptionPane.INFORMATION_MESSAGE);
        }
    }

}
