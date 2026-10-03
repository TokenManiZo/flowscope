package io.flowscope.ui;

import io.flowscope.core.Orchestrator;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Assumptions;
import javax.swing.*;
import javax.swing.plaf.ComponentUI;
import javax.swing.plaf.basic.BasicButtonUI;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

final class FlowScopeControlTabTest {
    @Test void controlTabPreservesProjectActionsWithoutMcpControls() throws Exception {
        List<String> labels = new ArrayList<>();
        SwingUtilities.invokeAndWait(() -> {
            FlowScopeControlTab tab = tab(new TestActions());
            collect(tab, labels);
            assertFalse(named(tab, "project.tools").isVisible());
        });
        assertTrue(labels.containsAll(List.of("프로젝트 열기", "로컬 DB 저장·연결", "JSON 내보내기",
                "Proxy History 가져오기", "샘플 프로젝트", "FlowScope Web UI 열기", "주소 복사")));
        assertFalse(labels.contains("새 트래픽 진단 시작"));
        assertFalse(labels.contains("범위 적용"));
        assertFalse(labels.stream().anyMatch(value -> value.contains("MCP") || value.contains("연결 문자열")));
    }

    @Test void projectToolsToggleKeepsImportsAndSampleActionsAvailable() throws Exception {
        SwingUtilities.invokeAndWait(() -> {
            TestActions actions = new TestActions();
            FlowScopeControlTab tab = tab(actions);
            JPanel tools = (JPanel) named(tab, "project.tools");
            JToggleButton toggle = (JToggleButton) named(tab, "project.tools.toggle");
            toggle.doClick();
            assertTrue(tools.isVisible());
            assertTrue(toggle.isSelected());
            button(tools, "Proxy History 가져오기").doClick();
            button(tools, "샘플 프로젝트").doClick();
            assertEquals(1, actions.imports);
            assertEquals(1, actions.samples);
            toggle.doClick();
            assertFalse(tools.isVisible());
            assertFalse(toggle.isSelected());
        });
    }

    @Test void primaryActionAndAddressStayAlignedWithoutStretching() throws Exception {
        SwingUtilities.invokeAndWait(() -> {
            FlowScopeControlTab tab = tab(new TestActions());
            int previousWidth = 0;
            for (int width : new int[] {640, 1440}) {
                tab.setSize(width, 800);
                layout(tab);
                Rectangle open = bounds(tab, named(tab, "web.open"));
                Rectangle address = bounds(tab, named(tab, "web.address"));
                Rectangle copy = bounds(tab, named(tab, "web.copy"));
                Rectangle toggle = bounds(tab, named(tab, "project.tools.toggle"));
                assertEquals(24, open.x);
                assertEquals(open.x, toggle.x);
                assertTrue(open.width < 300);
                assertTrue(address.x > open.x + open.width);
                assertTrue(copy.x > address.x + address.width);
                assertTrue(copy.x + copy.width <= width - 24);
                assertEquals(open.getCenterY(), address.getCenterY(), 1);
                assertEquals(open.getCenterY(), copy.getCenterY(), 1);
                if (previousWidth > 0) assertEquals(previousWidth, open.width);
                previousWidth = open.width;
            }
        });
    }

    @Test void collapsedSummaryCountsGeneratorsIndependentlyOfOrchestrator() throws Exception {
        FlowScopeControlTab[] tab = new FlowScopeControlTab[1];
        SwingUtilities.invokeAndWait(() -> {
            tab[0] = tab(new TestActions());
            JLabel scope = (JLabel) named(tab[0], "scope.summary");
            tab[0].setScopeText(null);
            assertEquals("설정된 범위 없음", scope.getText());
            tab[0].setScopeText("https://one.example.test/\nhttps://two.example.test/api");
            assertEquals("https://one.example.test/ · https://two.example.test/api", scope.getText());
        });
        RequestRecord scanner = record(Source.SCANNER, "/scanner");
        scanner.orchestrator = Orchestrator.LLM;
        tab[0].render(Pipeline.run(List.of(record(Source.HUMAN, "/human"), scanner,
                record(Source.LLM, "/llm"), record(Source.UNKNOWN, "/unknown"))));
        SwingUtilities.invokeAndWait(() -> {
            assertFalse(named(tab[0], "project.tools").isVisible());
            assertEquals("수집 4건 · HUMAN 1 · SCANNER 1 · LLM 1",
                    ((JLabel) named(tab[0], "collection.summary")).getText());
        });
    }

    @Test void hostThemeKeepsPrimaryAndSelectedToolsReadableAfterUiRefresh() throws Exception {
        SwingUtilities.invokeAndWait(() -> {
            Object buttonUi = UIManager.get("ButtonUI");
            Object toggleUi = UIManager.get("ToggleButtonUI");
            Object labelColor = UIManager.get("Label.foreground");
            try {
                UIManager.put("ButtonUI", TransparentHostButtonUI.class.getName());
                UIManager.put("ToggleButtonUI", TransparentHostButtonUI.class.getName());
                for (Color surface : new Color[] {Color.WHITE, new Color(0x292929)}) {
                    Color text = surface.equals(Color.WHITE) ? Color.BLACK : Color.WHITE;
                    UIManager.put("Label.foreground", text);
                    FlowScopeControlTab tab = tab(new TestActions());
                    JButton open = (JButton) named(tab, "web.open");
                    JToggleButton toggle = (JToggleButton) named(tab, "project.tools.toggle");
                    JButton copy = (JButton) named(tab, "web.copy");
                    toggle.setSelected(true);
                    SwingUtilities.updateComponentTreeUI(tab);
                    for (AbstractButton button : new AbstractButton[] {open, toggle, copy}) {
                        button.setSize(button.getPreferredSize());
                        for (int state = 0; state < 3; state++) {
                            boolean pressed = state == 2;
                            button.getModel().setRollover(state > 0);
                            button.getModel().setArmed(pressed);
                            button.getModel().setPressed(pressed);
                            BufferedImage image = new BufferedImage(button.getWidth(), button.getHeight(), BufferedImage.TYPE_INT_RGB);
                            Graphics2D graphics = image.createGraphics();
                            graphics.setColor(surface);
                            graphics.fillRect(0, 0, image.getWidth(), image.getHeight());
                            button.paint(graphics);
                            graphics.dispose();
                            if (button == open) {
                                Color fill = pressed ? new Color(0xc64a17).darker() : new Color(0xc64a17);
                                assertEquals(fill.getRGB(), image.getRGB(4, 4), "primary background must be painted");
                            }
                            Color foreground = button == open ? Color.WHITE : text;
                            assertEquals(foreground, button.getForeground(), "host interaction colors must not hide text");
                            assertTrue(hasPixel(image, foreground), "button text must contrast with its surface");
                        }
                    }
                }
            } finally {
                UIManager.put("ButtonUI", buttonUi);
                UIManager.put("ToggleButtonUI", toggleUi);
                UIManager.put("Label.foreground", labelColor);
            }
        });
    }

    @Test void toolsArrowSurvivesInvisibleHostIconsAndMouseDoesNotRequestFocus() throws Exception {
        SwingUtilities.invokeAndWait(() -> {
            Object collapsed = UIManager.get("Tree.collapsedIcon");
            Object expanded = UIManager.get("Tree.expandedIcon");
            Icon invisible = new Icon() {
                public int getIconWidth() { return 12; }
                public int getIconHeight() { return 12; }
                public void paintIcon(Component component, Graphics graphics, int x, int y) {}
            };
            try {
                UIManager.put("Tree.collapsedIcon", invisible);
                UIManager.put("Tree.expandedIcon", invisible);
                FlowScopeControlTab tab = tab(new TestActions());
                JToggleButton toggle = (JToggleButton) named(tab, "project.tools.toggle");
                for (int refresh = 0; refresh < 2; refresh++) {
                    if (refresh > 0) SwingUtilities.updateComponentTreeUI(tab);
                    int width = toggle.getPreferredSize().width;
                    assertFalse(toggle.isRequestFocusEnabled(), "mouse clicks must not leave a persistent focus rectangle");
                    assertTrue(toggle.isFocusable(), "keyboard traversal must remain available");
                    assertTrue(toggle.isFocusPainted(), "keyboard focus must remain visible");
                    for (Color foreground : new Color[] {Color.BLACK, Color.WHITE}) {
                        toggle.setForeground(foreground);
                        Color surface = foreground.equals(Color.BLACK) ? Color.WHITE : Color.BLACK;
                        BufferedImage[] arrows = new BufferedImage[2];
                        for (int state = 0; state < 2; state++) {
                            assertEquals(state == 1, toggle.isSelected());
                            assertEquals(state == 1, named(tab, "project.tools").isVisible());
                            Icon icon = toggle.getIcon();
                            assertNotNull(icon);
                            arrows[state] = new BufferedImage(icon.getIconWidth(), icon.getIconHeight(), BufferedImage.TYPE_INT_RGB);
                            Graphics2D graphics = arrows[state].createGraphics();
                            graphics.setColor(surface);
                            graphics.fillRect(0, 0, icon.getIconWidth(), icon.getIconHeight());
                            icon.paintIcon(toggle, graphics, 0, 0);
                            graphics.dispose();
                            assertTrue(hasDifferentPixel(arrows[state], surface), "disclosure arrow must be visible in both states");
                            toggle.doClick(0);
                            assertEquals(width, toggle.getPreferredSize().width);
                        }
                        boolean changed = false;
                        for (int y = 0; y < arrows[0].getHeight(); y++) {
                            for (int x = 0; x < arrows[0].getWidth(); x++) {
                                changed |= arrows[0].getRGB(x, y) != arrows[1].getRGB(x, y);
                            }
                        }
                        assertTrue(changed, "expanded arrow must have a different direction");
                    }
                }
            } finally {
                UIManager.put("Tree.collapsedIcon", collapsed);
                UIManager.put("Tree.expandedIcon", expanded);
            }
        });
    }

    private static boolean hasDifferentPixel(BufferedImage image, Color surface) {
        for (int y = 0; y < image.getHeight(); y++) {
            for (int x = 0; x < image.getWidth(); x++) {
                if (image.getRGB(x, y) != surface.getRGB()) return true;
            }
        }
        return false;
    }

    public static final class TransparentHostButtonUI extends BasicButtonUI {
        public static ComponentUI createUI(JComponent component) { return new TransparentHostButtonUI(); }
        @Override public void update(Graphics graphics, JComponent component) {
            if (((AbstractButton) component).isContentAreaFilled()) super.update(graphics, component);
            else paint(graphics, component);
        }
        @Override protected void paintText(Graphics graphics, AbstractButton button, Rectangle textRect, String text) {
            if (button.isSelected() || button.getModel().isRollover()) button.setForeground(Color.WHITE);
            super.paintText(graphics, button, textRect, text);
        }
    }

    private static boolean hasPixel(BufferedImage image, Color color) {
        for (int y = 6; y < image.getHeight() - 6; y++) {
            for (int x = 6; x < image.getWidth() - 6; x++) {
                if (image.getRGB(x, y) == color.getRGB()) return true;
            }
        }
        return false;
    }

    @Test void unavailableDesktopShowsInlineRecoveryWithoutOpeningADialog() throws Exception {
        Assumptions.assumeTrue(GraphicsEnvironment.isHeadless());
        SwingUtilities.invokeAndWait(() -> {
            FlowScopeControlTab tab = tab(new TestActions());
            JLabel status = (JLabel) named(tab, "web.status");
            assertFalse(status.isVisible());
            assertDoesNotThrow(() -> ((JButton) named(tab, "web.open")).doClick());
            assertTrue(status.isVisible());
            assertTrue(status.getText().contains("브라우저를 열지 못했습니다"));
            assertDoesNotThrow(() -> ((JButton) named(tab, "web.copy")).doClick());
            assertTrue(status.getText().contains("위 주소를 브라우저 주소창에 입력"));
        });
    }

    private static FlowScopeControlTab tab(TestActions actions) {
        return new FlowScopeControlTab(actions, "http://127.0.0.1:17777/");
    }

    private static RequestRecord record(Source source, String path) {
        RequestRecord record = new RequestRecord(source, "https://api.example.test:443", "GET", path, 200, "anon");
        record.hasResponse = true;
        return record;
    }

    private static final class TestActions implements FlowScopeControlTab.Actions {
        int imports, samples;
        public void importProxyHistory() { imports++; }
        public void loadSample() { samples++; }
        public void saveProject(File file) {}
        public void loadProject(File file) {}
    }

    private static Component named(Component component, String name) {
        if (name.equals(component.getName())) return component;
        if (component instanceof Container container) {
            for (Component child : container.getComponents()) {
                Component found = named(child, name);
                if (found != null) return found;
            }
        }
        return null;
    }

    private static JButton button(Component component, String label) {
        if (component instanceof JButton button && label.equals(button.getText())) return button;
        if (component instanceof Container container) {
            for (Component child : container.getComponents()) {
                JButton found = button(child, label);
                if (found != null) return found;
            }
        }
        return null;
    }

    private static void layout(Container container) {
        container.doLayout();
        for (Component child : container.getComponents()) {
            if (child instanceof Container nested && child.isVisible()) layout(nested);
        }
    }

    private static Rectangle bounds(Container root, Component component) {
        return SwingUtilities.convertRectangle(component.getParent(), component.getBounds(), root);
    }

    private static void collect(Component component, List<String> labels) {
        if (component instanceof AbstractButton button) labels.add(button.getText());
        if (component instanceof JLabel label) labels.add(label.getText());
        if (component instanceof Container container) {
            for (Component child : container.getComponents()) collect(child, labels);
        }
    }
}
