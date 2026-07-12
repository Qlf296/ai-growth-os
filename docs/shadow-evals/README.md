# Shadow-eval artifacts (ADR-045 / AT-14)

A PR that changes a decision-affecting config definition (weights, thresholds,
mappings, decision rules) must add its shadow-evaluation artifact here:
`<config-key>-<YYYYMMDD>.md` — scope, replay window, before/after metrics,
founder ratification. The CI gate (`gate:decision-config`) blocks the merge otherwise.
