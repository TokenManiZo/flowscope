package io.flowscope.ui;

import org.junit.jupiter.api.Test;
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
            FlowScopeControlTab tab = new FlowScopeControlTab(new FlowScopeControlTab.Actions() {
                public void importProxyHistory() {}
                public void loadSample() {}
                public void clearTraffic() {}
                public void saveProject(File file) {}
                public void loadProject(File file) {}
                public void updateScope(String value) {}
            }, "http://127.0.0.1:17777/", "8080 HUMAN, 8081 SCANNER");
            collect(tab, labels);
        });
        assertTrue(labels.contains("프로젝트 열기"));
        assertTrue(labels.contains("FlowScope Web UI 열기"));
        assertFalse(labels.stream().anyMatch(value -> value.contains("MCP") || value.contains("연결 문자열")));
    }
    private static void collect(Component component, List<String> labels) {
        if (component instanceof AbstractButton button) labels.add(button.getText());
        if (component instanceof JLabel label) labels.add(label.getText());
        if (component instanceof Container container) {
            for (Component child : container.getComponents()) collect(child, labels);
        }
    }
}
