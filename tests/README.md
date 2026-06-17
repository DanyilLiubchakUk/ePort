# ePort tests

## Purpose

Automated verification of external behavior per [docs/prd/eport-v1.md](../docs/prd/eport-v1.md) Testing Decisions: HTTP in/out, config side effects, CLI stdout/stderr — not private method call order.

## Will contain

Unit tests (table-driven suffix, effort, alias); golden fixtures for Claude/Codex translation; edge router integration tests; auth rotation scenarios; config equivalence tests; CLI subprocess tests with temp `HOME`; platform smoke tests for service install where CI allows.

## Blocked by / ISSUES slice

Resolver tests land with [02](../../docs/ISSUES/02-model-resolver-unit-tests.md); module coverage grows per slices 04–11. See PRD priority table: P0 resolver + Claude translator; P1 edge, auth, config, Codex client; P2 tunnel, service.

## Notes

Borrow table-driven fixture style from `vendors/codex-proxy-ts/tests/` — behavior only, not vendor codebase weight.
