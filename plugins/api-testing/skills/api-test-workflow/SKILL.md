---
name: api-test-workflow
description: Prepare and run contract-grounded API fixture suites through the api-testing plugin, including review, revision and targeted retests.
---

# API test workflow

Use the available `api_test_execute` tool. If unavailable, report the missing plugin/engine capability; do not substitute direct HTTP or raw MCP execution.

Current support is local OpenAPI 3.0 JSON with internal references and an explicit HTTP `127.0.0.1` origin on port >=8900. Real targets remain blocked pending runner isolation. A user supplying a writable test environment does not remove this implementation limitation.

Start with the user's selected operations and contract. Generate 1–3 small declarative cases with `id`, `operationId`, `request`, `status`, and `checks`. Each check uses `kind` (exists/type/enum/value), a JSON `pointer`, and an applicable `value`. An expected value or negative status needs a confirmed rule with its source. Do not infer error codes, JSON responses from wildcard media, optional-field presence, or business rules from examples. Missing data or unsupported critical constraints are blockers.

Call `prepare` with sourcePath, operationIds, cases, rules, baseUrl and a new project-local outputPath. Retain returned workflowRef as runRef and the evidence path. Preparation does not approve execution. Call `review`; use its structured findings to revise only the affected cases with `revise`, preserving the original contract and expectations. Each revision publishes a new directory and requires review again. Never create replacement workflows to reset limits: one workflow has 3 review calls, 2 revisions and a 180-second deadline.

Only run an approved suite. For a requested retest, use `retest` with the same runRef and explicit priorRunId; never automatically retry a failed or unknown request. Unknown writes require checking residual data before any further execution. Cancellation stops this run; it does not undo mutations.

Use `report` to inspect history without sending requests. Deliver evidence paths, executed/passed/failed/blocked/not-executed counts and cleanup status. Distinguish fixture verification, model stubs, actual model review and business acceptance. Workflows are currently in memory: after restart, preserve file evidence and do not claim execution can resume.
