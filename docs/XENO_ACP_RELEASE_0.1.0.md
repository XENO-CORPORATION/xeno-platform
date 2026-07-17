# XENO ACP 0.1.0 — Public Beta

XENO ACP is publicly installable for its tested trusted-local Windows and Linux scope.

- Install the OpenAI-compatible gateway with `npm install --global @xeno-corporation/xeno-acp`.
- Embed the structured client engine with `@xeno-corporation/xeno-acp-core`.
- Run the XENO-owned ACP endpoint and adapter runtime with `@xeno-corporation/xeno-acp-agent`.
- Use `@xeno-corporation/xeno-acp-provider-manager` for provider catalog, lifecycle, certification, and update policy.
- Initialize a safe local gateway configuration with `xeno-acp init`.
- Manage provider setup, model discovery, approvals, diagnostics, and redacted support data through the XENO Hub agent interface.

The exact 0.1.0 candidates passed clean package install/import/CLI checks, reproducibility and
release evidence, the full standalone product-ready gate on Windows and Ubuntu/Linux, and the
packaged XENO Hub agent-interface release chain.

Supported launch targets are Windows and Linux with Node.js 20 or newer. macOS is not claimed in
this release. XENO-authored local adapters are not official provider-owned ACP implementations and
use the operator's installed/authenticated provider CLI. The provider process supervisor is a
lifecycle boundary, not hostile-code network or filesystem containment.
