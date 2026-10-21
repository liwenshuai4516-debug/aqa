---
name: api-test-analyze
description: Interpret API test reports, retained findings, cleanup outcomes and targeted retest evidence without silently rerunning requests.
---

# API result analysis

Read the existing report using `api_test_execute` action report, runRef and optional runId. Historical analysis sends no requests and uses no model in the deterministic reporting path. Do not run or retest solely to obtain a cleaner report.

Distinguish assertion failures (suspected API defects), environment errors, testcase/script errors, cleanup failures and unknown/insufficient evidence. These categories are evidence-based clues, not proven root causes. Do not infer actual response values: raw bodies and assertion actual values are intentionally omitted from persisted output. Missing evidence stays unknown.

Preserve the first failure and every attempt. An unfixed retest remains open. Closing a finding requires an explicit priorRunId and a passing same-case result on the same suite hash. Changing a testcase requires fresh independent review and does not establish that the old business defect was fixed. Report old-version findings separately when a revised suite passes.

Report cleanup as passed, failed, not-required, not-defined or residuals-unknown according to evidence. A failed/unknown write or cleanup can leave test data behind; do not automatically resend, delete data or repair business code. Obtain the missing facts or applicable authorization before corrective actions.

Deliver counts and evidence links with fixture versus business scope and stub versus actual model scope. Report skips, blockers and unexecuted checks explicitly; neither a successful MCP transport nor an approved suite proves that its cases passed.
