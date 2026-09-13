package io.flowscope.core.discovery;

import io.flowscope.core.RouteCandidate;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NamedNodeMap;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;
import org.xml.sax.helpers.DefaultHandler;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/** 제품명에 의존하지 않고 명시 URL/HTTP method 문법만 읽는 안전한 XML adapter. */
public final class XmlRouteDiscoveryAdapter implements RouteDiscoveryAdapter {
    private static final Set<String> ROUTE_FIELDS = Set.of(
            "href", "action", "url", "uri", "endpoint", "path", "src", "target", "loc");
    private static final Set<String> METHOD_FIELDS = Set.of("method", "verb", "httpmethod");
    private static final int MAX_ELEMENTS = 10_000;

    @Override public String id() { return "xml-explicit-route"; }

    @Override
    public boolean supports(RouteDiscoveryDocument document) {
        String path = document.path().toLowerCase(Locale.ROOT);
        return document.mediaType().contains("xml") || path.endsWith(".xml") || path.endsWith(".xhtml");
    }

    @Override
    public List<DiscoveredRoute> discover(RouteDiscoveryDocument input) {
        try {
            var builder = builderFactory().newDocumentBuilder();
            builder.setErrorHandler(new DefaultHandler());
            builder.setEntityResolver((publicId, systemId) -> {
                throw new org.xml.sax.SAXException("external entity blocked");
            });
            Document document = builder.parse(
                    new ByteArrayInputStream(input.body().getBytes(StandardCharsets.UTF_8)));
            List<DiscoveredRoute> routes = new ArrayList<>();
            NodeList elements = document.getElementsByTagName("*");
            int count = Math.min(elements.getLength(), MAX_ELEMENTS);
            for (int i = 0; i < count; i++) inspect((Element) elements.item(i), routes);
            return List.copyOf(routes);
        } catch (Exception ignored) {
            return List.of();
        }
    }

    private void inspect(Element element, List<DiscoveredRoute> routes) {
        String method = explicitMethod(element);
        NamedNodeMap attributes = element.getAttributes();
        for (int i = 0; i < attributes.getLength(); i++) {
            Node attribute = attributes.item(i);
            if (ROUTE_FIELDS.contains(normalize(attribute.getNodeName())) && routeLike(attribute.getNodeValue())) {
                add(routes, attribute.getNodeValue(), method, RouteCandidate.ProvenanceType.XML_ROUTE,
                        "XML의 명시 URL attribute" + (method.equals("UNKNOWN") ? "" : "/method"));
            }
        }
        String name = normalize(element.getTagName());
        if (ROUTE_FIELDS.contains(name) && directTextOnly(element) && routeLike(element.getTextContent())) {
            RouteCandidate.ProvenanceType type = name.equals("loc")
                    ? RouteCandidate.ProvenanceType.ROBOTS_OR_SITEMAP : RouteCandidate.ProvenanceType.XML_ROUTE;
            add(routes, element.getTextContent(), method, type,
                    "XML의 명시 URL element" + (method.equals("UNKNOWN") ? "" : "/method"));
        }
    }

    private void add(List<DiscoveredRoute> routes, String reference, String method,
                     RouteCandidate.ProvenanceType type, String reason) {
        routes.add(new DiscoveredRoute(reference.trim(), method, type,
                method.equals("UNKNOWN") ? RouteCandidate.Applicability.REVIEW : RouteCandidate.Applicability.APPLICABLE,
                reason, id()));
    }

    private static String explicitMethod(Element element) {
        NamedNodeMap attributes = element.getAttributes();
        for (int i = 0; i < attributes.getLength(); i++) {
            Node attribute = attributes.item(i);
            if (METHOD_FIELDS.contains(normalize(attribute.getNodeName()))) return attribute.getNodeValue();
        }
        return "UNKNOWN";
    }

    private static boolean directTextOnly(Element element) {
        NodeList children = element.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) if (children.item(i).getNodeType() == Node.ELEMENT_NODE) return false;
        return true;
    }

    private static boolean routeLike(String value) {
        if (value == null) return false;
        String route = value.trim().toLowerCase(Locale.ROOT);
        return route.startsWith("/") || route.startsWith("./") || route.startsWith("../")
                || route.startsWith("http://") || route.startsWith("https://") || route.startsWith("//")
                || (!route.contains(" ") && route.contains("/"));
    }

    private static String normalize(String value) {
        if (value == null) return "";
        int colon = value.indexOf(':');
        String local = colon < 0 ? value : value.substring(colon + 1);
        return local.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
    }

    private static DocumentBuilderFactory builderFactory() throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
        factory.setXIncludeAware(false);
        factory.setExpandEntityReferences(false);
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
        factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
        return factory;
    }
}
