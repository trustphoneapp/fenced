# Architecture v3 accepted index

State: `ARCHITECTURE_V3_FROZEN_FOR_LOCAL_SYNTHETIC_IMPLEMENTATION_WITH_OPEN_RUNTIME_RISKS`

This index binds the accepted Architecture v3 design baseline used by the E-0060
scoped A13 freeze. Every identity below was computed from the current regular
file before this index was created. All bound files have mode `0644`.

## Accepted A00-A12 artifacts

| Task | Accepted artifact | Bytes | LF lines | SHA-256 | Mode |
| --- | --- | ---: | ---: | --- | --- |
| A00 | `requirements-traceability-v3.md` | 75699 | 379 | `6f2672bdaabe8dd3fa07cbdc7f6d26e6cfcd12f9c7040927db83ede8d2cc1c6d` | `0644` |
| A01 | `../governance/ownership-and-provenance.md` | 16584 | 313 | `329f7265cda4bfb351b2c9f0b9986e972fc9ee2f1cbee3b614b0f1f365d14156` | `0644` |
| A01 | `../hackathon/preexisting-code-disclosure.md` | 5765 | 89 | `d50b6b8f0b541d835ae934ef2e9df97c191a8912589e33741a65011576926458` | `0644` |
| A02 | `system-trust-boundaries-v3.md` | 194041 | 1956 | `9ac203dd631bd070605e33ae904ad5441ce0d7962524cfbda9abfc384c3805fc` | `0644` |
| A03 | `data-deletion-lifecycle-v3.md` | 124673 | 1201 | `a2a65f9132f1683242943732d483eb1cd0e80c57a8e68db6090b3d953e9ad3d8` | `0644` |
| A04 | `governed-decision-path-v3.md` | 198593 | 1793 | `a013ba4886c77f401afc028f4ff2c99f19ec181541de58d65bd94fee798877af` | `0644` |
| A05 | `experimental-learning-promotion-v3.md` | 67436 | 906 | `e64c03ecaa7a4d875e021e8711fc4ed2397eb5a50e22e8405c5be7c1e50718d8` | `0644` |
| A06 | `independent-system-boundary-v3.md` | 21071 | 165 | `d0c90e13d59324b706db00376c8661a89d5dd4aed053dff3a8d80691b7fe8d4a` | `0644` |
| A07 | `erasable-payload-adr-v3.md` | 77499 | 831 | `d1e5f2a4b5e49b604273ebab7cd70520040b33ba55ebb87e5472a77e2903c0c1` | `0644` |
| A08 | `tenant-isolation-adr-v3.md` | 64492 | 621 | `5e79d1ff11774c18d9e3b5175e76c72add2c473bbde035ded41c785aed3ce8ce` | `0644` |
| A09 | `policy-order-and-tool-authorization-adr-v3.md` | 93445 | 916 | `479efdd7668aa78db0397b1b8778232fe39e1564b8c0aaf4de6dbd9fe157c4ae` | `0644` |
| A10 | `versioning-and-receipt-adr-v3.md` | 126862 | 1430 | `9b777af8ac3a1b03ca69110233204dab78218eca8ff0588d85e4552b31da0718` | `0644` |
| A11 | `core-semantic-adr-set-v3.md` | 842281 | 4411 | `ea9c9ec2b1dd81d5d8f656f5dc3b349c32882a7dc8c53af2f8fb7a3a5b557b97` | `0644` |
| A12 | `threat-privacy-abuse-model-v3.md` | 55257 | 485 | `b86c7d712280d225362bdabee9b50f506b0e57d19597f35a76d2a7c07e2a05be` | `0644` |

## A13 prerequisite and gate bindings

| Scope | Artifact | Bytes | LF lines | SHA-256 | Mode |
| --- | --- | ---: | ---: | --- | --- |
| `A13-PREREQ-R3` | `../governance/a13-prerequisite-definition.md` | 42481 | 240 | `a8c0be27d83c86817ebf94e21623e028894e7dc3e739edc93738baeedae8dc41` | `0644` |
| HG-1 / HG1-RP01 | `../governance/hg1-human-decision-packet.md` | 52932 | 538 | `0f7d48b0fa265f5442a615213ea7eb6271334040fe4f8a2004c24c445084ed71` | `0644` |
| HG-2 / HG2-RP01 | `../governance/hg2-human-decision-packet.md` | 37174 | 580 | `2b2d92363d66dd264e0b5beba08d7710e3b52550b75c6e28b37b54048c58da14` | `0644` |
| HG-3 / HG3-RP01 | `../governance/hg3-human-decision-packet.md` | 35893 | 437 | `efb28005a11cb3244e2014db23a49d97d7675de22d6f427010dbd41e4ff54c13` | `0644` |
| HG-4 / HG4-RP01 | `../governance/hg4-human-decision-packet.md` | 58507 | 610 | `20c05b92db9e8a6c91b03e539d41f0c7d3c6b715e6e5ea47ebdd4b487c39b8df` | `0644` |

The gate packets remain effective only for their exact accepted profiles,
decision mappings, scopes, and `NONE` exceptions. HG-5 and HG-6 remain pending.

## Scoped freeze and risk split

- A13 is complete only for dependency-ordered local implementation using synthetic
  data. At the exact E-0060 freeze snapshot, B01 workspace bootstrap was the sole
  pending task; later task progression is recorded only in the implementation
  manifest, status, and evidence ledger.
- `BLOCK-07`, `BLOCK-08`, and `BLOCK-09` are superseded only as barriers to this
  local/synthetic A13 freeze. They remain active for operational or real-data
  work, credentials, network or provider execution, cloud, deployment, release,
  production, and any broader architecture freeze.
- `BLOCK-01` through `BLOCK-06` remain fully active.
- `RR-01` through `RR-18` remain `UNRESOLVED`. E-0060 supplies no runtime evidence,
  control-effectiveness proof, closure, acceptance, downgrade, or waiver.

## Authority boundary

Standing owner authorization permits one dependency-ready local/synthetic batch at
a time, with automatic fresh independent verification and evidence recording. It
does not authorize access to the private Zintus repository, real or private data,
credentials, IAM, keys, provider/model/embedding/tool/MCP execution, network calls,
AWS or CockroachDB Cloud resources, deployment, release, submission, production,
or Git staging, commit, push, pull request, or publication.
