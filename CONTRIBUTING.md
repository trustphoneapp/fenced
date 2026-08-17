# Contributing

## Independence rule

Contributions must be newly authored for this repository. Do not copy source, tests, generated artifacts, Git history, or private documentation from the existing Zintus repository. Concepts learned from pre-existing work must be disclosed in `docs/hackathon/preexisting-code-disclosure.md`.

## Change requirements

Every change must:

1. identify its task and acceptance criteria;
2. stay inside the approved dependency boundary;
3. include proportionate tests;
4. avoid secrets and real user data;
5. preserve tenant, provenance, temporal, policy, deletion, and idempotency invariants;
6. update architecture or disclosure records when applicable;
7. pass formatting, typecheck, tests, dependency, license, and secret gates.

Schema, public contract, privacy-policy, retention, or provider-destination changes require an ADR and the relevant human approval before implementation.

## Commit policy

Use small, reviewable commits. Commit messages should state the task and outcome. Never rewrite published history to hide a disclosure, security finding, or failed evaluation.
