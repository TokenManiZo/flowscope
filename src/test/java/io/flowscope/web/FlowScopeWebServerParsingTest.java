package io.flowscope.web;

import io.flowscope.integration.ZapCampaign;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

final class FlowScopeWebServerParsingTest {
    @Test
    void parsesCompactExplicitZapDefinitionLinesWithoutGuessing() {
        List<ZapCampaign.ZapDefinition> definitions = FlowScopeWebServer.parseZapDefinitions("""
                OPENAPI https://api.example.test/openapi.json
                GRAPHQL https://api.example.test/graphql https://api.example.test/schema.graphql
                POSTMAN https://api.example.test/collection.json
                SOAP https://api.example.test/service.wsdl
                """);

        assertEquals(4, definitions.size());
        assertEquals(ZapCampaign.ZapDefinitionType.OPENAPI, definitions.get(0).type());
        assertEquals("https://api.example.test/graphql", definitions.get(1).endpoint());
        assertEquals("https://api.example.test/schema.graphql", definitions.get(1).url());
        assertThrows(IllegalArgumentException.class,
                () -> FlowScopeWebServer.parseZapDefinitions("OPENAPI https://a.test/a extra"));
    }

    @Test
    void treatsABareUrlLineAsAnOpenApiDefinition() {
        List<ZapCampaign.ZapDefinition> definitions = FlowScopeWebServer.parseZapDefinitions("""
                http://localhost:8000/api/v2/docs.json
                HTTPS://api.example.test/openapi.yaml
                POSTMAN https://api.example.test/collection.json
                """);

        assertEquals(3, definitions.size());
        assertEquals(new ZapCampaign.ZapDefinition(ZapCampaign.ZapDefinitionType.OPENAPI,
                "http://localhost:8000/api/v2/docs.json", ""), definitions.get(0));
        assertEquals(new ZapCampaign.ZapDefinition(ZapCampaign.ZapDefinitionType.OPENAPI,
                "HTTPS://api.example.test/openapi.yaml", ""), definitions.get(1));
        assertEquals(ZapCampaign.ZapDefinitionType.POSTMAN, definitions.get(2).type());
        // 주소 두 개를 한 줄에 쓰거나 형식 이름이 틀리면 지금처럼 거부한다.
        assertThrows(IllegalArgumentException.class,
                () -> FlowScopeWebServer.parseZapDefinitions("https://a.test/a https://a.test/b"));
        assertThrows(IllegalArgumentException.class,
                () -> FlowScopeWebServer.parseZapDefinitions("SWAGGER https://a.test/a"));
    }
}
