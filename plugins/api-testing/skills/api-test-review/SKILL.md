---
name: api-test-review
description: Review the basis and bounded independent approval of a frozen API test suite when using the api-testing plugin.
---

# API suite review

Use the available `api_test_execute` review action for the exact workflow runRef. Its host-owned independent `llm.complete` call checks the frozen artifact and has no execution tools. A chat opinion or imported pass label cannot sign approval. If no dedicated model is configured, report blocked; a stub demonstrates control flow only.

Check each selected case against the provided contract and confirmed rules: method/path, required request data, expected status, JSON media, required fields, type/enum and explicit values. Missing authorization semantics, wildcard response media or undocumented status mappings must remain uncertain. Check unsupported diagnostics; do not silently discard critical constraints or relax a failing assertion to match observed behavior.

Treat model findings as proposed corrections. The host validates structured output, artifact hash and current case IDs. Illegal/truncated output and wrong hashes consume the shared budget rather than authorizing execution. Follow return findings with focused `revise` into a new outputPath and review again. Missing business facts yield blocked; repeated unchanged findings yield a finite stop. Do not re-create a workflow to bypass its call/time/revision budget.

Record the actual reviewed version, findings and model usage (unknown when missing). The host lacks provider cancellation: timeout prevents further workflow steps but does not prove a remote model call stopped or incurred zero cost. Keep actual-model semantic acceptance distinct from deterministic compilation checks and model-stub tests.
