# Migration notes — 20260712000017_track_record (ADR-043)

## Intent
Per-detector learned track record + health (ADR-042 detector health; ADR-013 bounded learned arbitration). Written by the Learning Propagator only (I5, one auditable pen). score is grade-weighted success in [0,1]; NULL below the min-samples floor (abstention). health ∈ healthy/degraded/retire_candidate/insufficient_data.

## Rollback
Expand-only. DROP TABLE detector_track_record; -- contract:

## Backfill
None — recomputed by the propagator from graded outcomes.
