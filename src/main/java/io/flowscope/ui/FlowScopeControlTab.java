package io.flowscope.ui;

import io.flowscope.core.Pipeline;
import javax.swing.BorderFactory;
import javax.swing.AbstractButton;
import javax.swing.Box;
import javax.swing.BoxLayout;
import javax.swing.JButton;
import javax.swing.JFileChooser;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JToggleButton;
import javax.swing.SwingUtilities;
import javax.swing.UIManager;
import javax.swing.filechooser.FileNameExtensionFilter;
import javax.swing.plaf.basic.BasicButtonUI;
import java.awt.BorderLayout;
import java.awt.Color;
import java.awt.Desktop;
import java.awt.Dimension;
import java.awt.FlowLayout;
import java.awt.Font;
import java.awt.Graphics;
import java.awt.Rectangle;
import java.awt.Toolkit;
import java.awt.datatransfer.StringSelection;
import java.io.File;
import java.net.URI;

/** Burp에서는 Web UI를 열고, 파일 작업과 수집 요약은 필요할 때만 펼친다. */
public final class FlowScopeControlTab extends JPanel {
    public interface Actions {
        void importProxyHistory();
        void loadSample();
        void saveProject(File file);
        void loadProject(File file);
    }

    private final Actions actions;
    private final String webUrl;
    private final JLabel scope = new JLabel("설정된 범위 없음");
    private final JLabel collection = new JLabel("수집 0건 · HUMAN 0 · SCANNER 0 · LLM 0");
    private final JLabel webStatus = new JLabel();
    public FlowScopeControlTab(Actions actions, String webUrl) {
        super(new BorderLayout());
        this.actions = actions;
        this.webUrl = webUrl;
        setBorder(BorderFactory.createEmptyBorder(24, 24, 24, 24));
        JPanel content = new JPanel();
        content.setLayout(new BoxLayout(content, BoxLayout.Y_AXIS));
        content.add(header());
        content.add(Box.createVerticalStrut(20));
        content.add(projectTools());
        add(content, BorderLayout.NORTH);
    }

    public void setScopeText(String value) {
        scope.setText(value == null || value.isBlank() ? "설정된 범위 없음"
                : value.strip().replace("\r", "").replace("\n", " · "));
    }

    public void render(Pipeline.Result result) {
        int human = 0, scanner = 0, llm = 0;
        for (var record : result.records) {
            switch (record.source) {
                case HUMAN -> human++;
                case SCANNER -> scanner++;
                case LLM -> llm++;
                default -> { }
            }
        }
        String summary = "수집 " + result.records.size() + "건 · HUMAN " + human
                + " · SCANNER " + scanner + " · LLM " + llm;
        SwingUtilities.invokeLater(() -> collection.setText(summary));
    }

    private JPanel header() {
        JPanel panel = new JPanel(new BorderLayout(0, 16));
        panel.setAlignmentX(LEFT_ALIGNMENT);
        JLabel title = new JLabel("FlowScope");
        title.setFont(title.getFont().deriveFont(Font.BOLD, 20f));
        panel.add(title, BorderLayout.NORTH);
        JPanel launch = new JPanel(new FlowLayout(FlowLayout.LEFT, 0, 0));
        JButton open = new JButton("FlowScope Web UI 열기") {
            @Override public void updateUI() { setUI(new ControlButtonUI()); }
        };
        open.setName("web.open");
        open.setFont(open.getFont().deriveFont(Font.BOLD, 14f));
        open.setBackground(new Color(0xc64a17));
        open.setForeground(Color.WHITE);
        open.setContentAreaFilled(true);
        open.setOpaque(true);
        open.setBorder(BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(open.getBackground()),
                BorderFactory.createEmptyBorder(8, 14, 8, 14)));
        open.addActionListener(ignored -> openWeb());
        launch.add(open);
        launch.add(Box.createHorizontalStrut(16));
        JLabel address = new JLabel(webUrl);
        address.setName("web.address");
        address.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 13));
        launch.add(address);
        launch.add(Box.createHorizontalStrut(12));
        JButton copy = new JButton("주소 복사") {
            @Override public void updateUI() { setUI(new ControlButtonUI()); }
        };
        copy.addActionListener(ignored -> copyWebAddress());
        copy.setName("web.copy");
        copy.setContentAreaFilled(false);
        copy.setBorder(BorderFactory.createEmptyBorder(4, 0, 4, 0));
        launch.add(copy);
        panel.add(launch, BorderLayout.CENTER);
        webStatus.setName("web.status");
        webStatus.setVisible(false);
        panel.add(webStatus, BorderLayout.SOUTH);
        return panel;
    }

    private JPanel projectTools() {
        JPanel root = new JPanel(new BorderLayout(0, 12));
        root.setAlignmentX(LEFT_ALIGNMENT);
        JPanel details = new JPanel();
        details.setName("project.tools");
        details.setLayout(new BoxLayout(details, BoxLayout.Y_AXIS));
        details.setVisible(false);
        JLabel note = new JLabel("새 프로젝트와 범위 설정은 Web UI에서 합니다.");
        note.setAlignmentX(LEFT_ALIGNMENT);
        details.add(note);
        details.add(Box.createVerticalStrut(12));
        JPanel files = new JPanel(new FlowLayout(FlowLayout.LEFT, 0, 0));
        files.setAlignmentX(LEFT_ALIGNMENT);
        files.add(button("프로젝트 열기", this::chooseLoad));
        files.add(Box.createHorizontalStrut(8));
        files.add(button("로컬 DB 저장·연결", this::chooseSave));
        files.add(Box.createHorizontalStrut(8));
        files.add(button("JSON 내보내기", this::chooseJsonExport));
        details.add(files);
        details.add(Box.createVerticalStrut(8));
        JPanel data = new JPanel(new FlowLayout(FlowLayout.LEFT, 0, 0));
        data.setAlignmentX(LEFT_ALIGNMENT);
        data.add(button("Proxy History 가져오기", actions::importProxyHistory));
        data.add(Box.createHorizontalStrut(8));
        data.add(button("샘플 프로젝트", actions::loadSample));
        details.add(data);
        details.add(Box.createVerticalStrut(20));
        scope.setName("scope.summary");
        scope.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 13));
        JPanel currentScope = new JPanel(new BorderLayout(12, 0));
        currentScope.setAlignmentX(LEFT_ALIGNMENT);
        JLabel scopeLabel = new JLabel("현재 범위");
        scopeLabel.setPreferredSize(new Dimension(80, scopeLabel.getPreferredSize().height));
        currentScope.add(scopeLabel, BorderLayout.WEST);
        currentScope.add(scope, BorderLayout.CENTER);
        details.add(currentScope);
        collection.setName("collection.summary");
        collection.setAlignmentX(LEFT_ALIGNMENT);
        details.add(Box.createVerticalStrut(12));
        details.add(collection);
        JToggleButton toggle = new JToggleButton("프로젝트 도구", UIManager.getIcon("Tree.collapsedIcon")) {
            @Override public void updateUI() { setUI(new ControlButtonUI()); }
        };
        toggle.setName("project.tools.toggle");
        toggle.setContentAreaFilled(false);
        toggle.setBorder(BorderFactory.createEmptyBorder(4, 0, 4, 0));
        toggle.getAccessibleContext().setAccessibleDescription("파일 작업과 범위·수집 요약을 펼치거나 접습니다.");
        toggle.addActionListener(ignored -> {
            details.setVisible(toggle.isSelected());
            toggle.setIcon(UIManager.getIcon(toggle.isSelected() ? "Tree.expandedIcon" : "Tree.collapsedIcon"));
            revalidate();
            repaint();
        });
        JPanel toggleRow = new JPanel(new FlowLayout(FlowLayout.LEFT, 0, 0));
        toggleRow.add(toggle);
        root.add(toggleRow, BorderLayout.NORTH);
        root.add(details, BorderLayout.CENTER);
        return root;
    }

    /** Keep the three custom controls readable when Burp skips transparent backgrounds or changes selected text. */
    private static final class ControlButtonUI extends BasicButtonUI {
        @Override protected void installDefaults(AbstractButton button) {
            super.installDefaults(button);
            button.setForeground("web.open".equals(button.getName()) ? Color.WHITE : UIManager.getColor("Label.foreground"));
        }

        @Override protected void paintButtonPressed(Graphics graphics, AbstractButton button) {
            if (button.isContentAreaFilled()) {
                graphics.setColor(button.getBackground().darker());
                graphics.fillRect(0, 0, button.getWidth(), button.getHeight());
            }
        }

        @Override protected void paintFocus(Graphics graphics, AbstractButton button,
                Rectangle viewRect, Rectangle textRect, Rectangle iconRect) {
            graphics.setColor(button.getForeground());
            graphics.drawRect(3, 3, button.getWidth() - 7, button.getHeight() - 7);
        }
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

    private void copyWebAddress() {
        try {
            Toolkit.getDefaultToolkit().getSystemClipboard().setContents(new StringSelection(webUrl), null);
            showWebStatus("Web UI 주소를 복사했습니다.");
        } catch (RuntimeException error) {
            showWebStatus("주소를 복사하지 못했습니다. 위 주소를 브라우저 주소창에 입력해 주세요.");
        }
    }

    private void showWebStatus(String message) {
        webStatus.setText(message);
        webStatus.setVisible(true);
        revalidate();
        repaint();
    }

    private void openWeb() {
        webStatus.setVisible(false);
        try {
            if (!Desktop.isDesktopSupported()) throw new IllegalStateException("Desktop browse unavailable");
            Desktop.getDesktop().browse(URI.create(webUrl));
        } catch (Exception error) {
            showWebStatus("브라우저를 열지 못했습니다. 주소를 복사해 브라우저 주소창에 붙여넣어 주세요.");
        }
    }

}
