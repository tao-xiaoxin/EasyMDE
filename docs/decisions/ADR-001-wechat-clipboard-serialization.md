# ADR-001: Portable WeChat Clipboard Serialization

- Status: Accepted
- Date: 2026-08-02
- Owners: EasyMDE React browser integrations and Preview

## Context

EasyMDE renders a sanitized Preview for the author, while WeChat displays pasted content in a different document environment. Copying the source or maintaining separate rendered outputs can make pasted content diverge from what the author reviewed.
Copy is an author-initiated compatibility operation. It must not save, publish, or otherwise change Markdown, `post_content`, metadata, revisions, or publication state.

## Decision

The WeChat export session uses one current, stable Preview sink for both the ordinary and immersive editor. The session passes that sink to one browser serializer, which produces the copy payload from the content the author reviewed.
All supported browser copy paths consume the same serializer output, so browser support does not create separate representations. Copy success is reported only when the browser reports a successful operation; unsupported and failed operations remain explicit failures and never become partial or silent success.
WeChat export has no document or persistence authority. It does not save, publish, or change the article.

## Alternatives Rejected

- **A second renderer:** Rendering Markdown again for WeChat would create a second content authority and could diverge from the current Preview.
- **Copying source Markdown:** Copying source would discard the rendered Preview the author reviewed and would expose editor-oriented content instead of the intended rich-text result.
- **Two serializers:** Maintaining distinct serializers for browser support paths would allow output and failure behavior to drift; one serializer keeps the representations aligned.

## Consequences

The copied result follows the current Preview shared by ordinary and immersive editing, while WordPress remains the authority for article state and publication.
Browser support, permissions, and destination behavior can still cause an explicit copy failure, so the interface must expose the actual result rather than promise success. Detailed implementation behavior remains with the technical contract and is linked in Verification route.

## Verification route

The executable WeChat contract is maintained in [the EasyMDE WeChat export reference](../../.agents/skills/easymde/references/wechat-export.md). Current ownership facts are maintained in [ARCHITECTURE.md](../ARCHITECTURE.md), and focused tests and browser evidence are routed through [TESTING_AND_RELEASE.md](../TESTING_AND_RELEASE.md). This ADR records the rationale only; those documents own implementation details and verification procedures.
