# Infrastructure

`template.yaml` is a local-reviewed CloudFormation template for the synthetic-only hackathon demo. It is not deployed by this repository. It accepts only an immutable, digest-qualified ARM64 image URI for `zc-e4-continuity-demo` and passes only the bounded `DatabaseSecretArn` to Lambda. The reviewed image resolves that secret through `asm-exec` only after strict API validation. Live AWS, Cockroach, Bedrock, and public-URL evidence remains pending E4 deployment.

The direct execute-api endpoint remains enabled, public, and `AuthorizationType: NONE`; removing its `ApiUrl` output only stops advertising it. The five direct-API security headers come from the Lambda handler and therefore do not cover API Gateway-generated 404, 429, or 5xx responses.

The monthly USD 25 budget sends separate 80% actual and forecasted email alerts. It is alert-only, is evaluated daily with possible provider latency, and depends on recipient email confirmation; it does not stop spend. The function reserves one concurrent execution. Before deployment, verify that the Lambda account in the target Region retains AWS's required unreserved concurrency after that reservation.
