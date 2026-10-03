package io.flowscope.ui;

import io.flowscope.core.Orchestrator;
import io.flowscope.core.Pipeline;
import io.flowscope.core.RequestRecord;
import io.flowscope.core.Source;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Assumptions;
import javax.swing.*;
import java.awt.*;
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
