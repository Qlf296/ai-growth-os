# ADR_DECISION_TREE.md — AI Growth OS

**Status:** v2.1 navigation aid (not a rule — a map). "Where's the decision about X?" answered in one hop. Full detail in the ARCHITECTURE_REVIEW.md index; this is the by-topic view.

```
IDENTITY & ACCESS
  auth/sessions ......... ADR-016, 017 · passwordless, server sessions
  connections/tokens .... ADR-019 · workspace-owned, authorized_by
  tenancy ............... S3 §11 · scoped repos + RLS + leak tests
  permissions ........... ADR-018 · Model-A UI / Model-B schema

DATA & STATE
  core model ............ ADR-006 · hybrid state + append-only events
  provider abstraction .. ADR-007, 021 · capabilities-as-data, adapter contract
  schema evolution ...... ADR-043 · expand-contract
  config ................ ADR-046 · config-as-data (+stability)

INTELLIGENCE & LEARNING
  ladder/cost ........... ADR-009, 011 · tiers, on-accept T4
  pipelines ............. ADR-004, 010 · deterministic, Strategy Profile
  baselines/state ....... ADR-022, 023, 024, 025 · shared normal, growth model, events, meas≠interp
  knowledge ............. ADR-012 (+xws policy), 039 · promotion, freshness/decay
  learning quality ...... ADR-033, 042 · grades, detector health
  memory ................ S15 · eight typed memories, one writer each

DECISION CORE
  scoring/arbitration ... ADR-013 + S16 · bounded learned arbitration, the formula
  traceability .......... ADR-044 · decision traces (+prompt version)
  replay/shadow-eval .... ADR-045 · scoped replay, mandatory gate
  evidence .............. ADR-035 · single Evidence Generator

CONTENT & CHANNELS
  social/voice .......... ADR-026, 027, 028 · taxonomy, voice, playbooks
  seo ................... ADR-030, 031, 032 · CTR curve, one-page-one-action, crawler
  competitor ............ ADR-036, 037, 038 · nomination, polite protocol, facts-not-profiles
  measurement indep. .... ADR-020 · UTM
  automation ............ ADR-048 · A2 permitted, A3/A4 forbidden

DELIVERY & OPS
  notifications ......... ADR-014 · budget, single send path
  observability ......... ADR-047 · SLIs, states, owners
  feature lifecycle ..... ADR-040 · kill rule
  capability truth ...... ADR-041 · registry

GOVERNANCE (above ADRs)
  invariants ............ SYSTEM_INVARIANTS.md (I1–I14)
  constitution .......... PRODUCT_ETHICAL_RULES.md (16 laws)
  decision process ...... DECISION_LIFECYCLE.md
```
