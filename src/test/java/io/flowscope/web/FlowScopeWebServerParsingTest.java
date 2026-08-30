package io.flowscope.web;

import io.flowscope.integration.McpServer;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

final class FlowScopeWebServerParsingTest {
    @Test
    void parsesCompactExplicitZapDefinitionLinesWithoutGuessing() {
        List<McpServer.ZapDefinition> definitions = FlowScopeWebServer.parseZapDefinitions("""
                OPENAPI https://api.example.test/openapi.json
                GRAPHQL https://api.example.test/graphql https://api.example.test/schema.graphql
                POSTMAN https://api.example.test/collection.json
                SOAP https://api.example.test/service.wsdl
                """);

        assertEquals(4, definitions.size());
        assertEquals(McpServer.ZapDefinitionType.OPENAPI, definitions.get(0).type());
        assertEquals("https://api.example.test/graphql", definitions.get(1).endpoint());
        assertEquals("https://api.example.test/schema.graphql", definitions.get(1).url());
        assertThrows(IllegalArgumentException.class,
                () -> FlowScopeWebServer.parseZapDefinitions("OPENAPI https://a.test/a extra"));
    }
}
