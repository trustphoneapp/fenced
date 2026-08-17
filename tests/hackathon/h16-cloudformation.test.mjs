import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const [template, readme] = await Promise.all([
  readFile(new URL("../../infrastructure/template.yaml", import.meta.url), "utf8"),
  readFile(new URL("../../infrastructure/README.md", import.meta.url), "utf8"),
]);

describe("H16 CloudFormation least-privilege template", () => {
  it("pins the bounded Lambda and HTTP API surface", () => {
    expect(template).toContain("Type: AWS::Lambda::Function");
    expect(template).toContain("PackageType: Image");
    expect(template).toContain("ImageUri: !Ref LambdaImageUri");
    expect(template).toContain("Command: [index.handler]");
    expect(template).toContain("Architectures: [arm64]");
    expect(template).toContain("Timeout: 25");
    expect(template).not.toMatch(/Runtime:|Handler:|S3Bucket:|S3Key:/);
    expect(template).toContain("ReservedConcurrentExecutions: 1");
    expect(template).toContain("FunctionName: zc-e4-continuity-demo");
    expect(template).toContain("RoleName: zc-e4-continuity-demo-runtime");
    expect(template).toContain("LogGroupName: /aws/apigateway/zc-e4-continuity-demo");
    expect(template).toContain("BucketName: !Sub zc-e4-continuity-demo-$" + "{AWS::AccountId}");
    expect(template).not.toContain("zintus-continuity");
    expect(template).toContain("RouteKey: POST /api/demo");
    expect(template).toContain("RouteKey: GET /api/health");
    expect(template).toMatch(
      /lambda:path\/2015-03-31\/functions\/\$\{DemoFunction\.Arn\}\/invocations/,
    );
    expect(template).toContain("ThrottlingBurstLimit: 2");
    expect(template).toContain("AllowedMethods: [GET, HEAD, OPTIONS, POST]");
    expect(template).not.toContain(
      "AllowedMethods: [GET, HEAD, OPTIONS, PUT, PATCH, POST, DELETE]",
    );
    expect(template.match(/AuthorizationType: NONE/gu)).toHaveLength(2);
    expect(template).not.toContain("DisableExecuteApiEndpoint: true");
    expect(template).not.toMatch(/^ {2}ApiUrl:/mu);
    expect(template).not.toMatch(/RouteKey: .*\*/);
  });

  it("adds the required USD 25 alert-only budget", () => {
    const parameter = template.slice(
      template.indexOf("  BudgetAlertEmail:"),
      template.indexOf("\n\nResources:"),
    );
    expect(parameter).toContain("Type: String");
    expect(parameter).not.toContain("Default:");
    expect(template).toContain("Type: AWS::Budgets::Budget");
    expect(template).toContain('BudgetLimit: { Amount: "25", Unit: USD }');
    expect(template.match(/NotificationType: ACTUAL/gu)).toHaveLength(1);
    expect(template.match(/NotificationType: FORECASTED/gu)).toHaveLength(1);
    expect(template.match(/Threshold: 80/gu)).toHaveLength(2);
    expect(template.match(/ThresholdType: PERCENTAGE/gu)).toHaveLength(2);
    expect(template.match(/Address: !Ref BudgetAlertEmail/gu)).toHaveLength(2);
    expect(template.match(/SubscriptionType: EMAIL/gu)).toHaveLength(2);
  });

  it("is accepted by a local YAML parser and quotes IAM actions", () => {
    const parsed = spawnSync(
      "ruby",
      ["-e", 'require "yaml"; YAML.load_file(ARGV.fetch(0))', "infrastructure/template.yaml"],
      { encoding: "utf8" },
    );
    expect(parsed.status, parsed.stderr).toBe(0);
    expect(template).not.toMatch(/Action: (?:\[)?[a-z]+:/);
  });

  it("allows only the two Bedrock models and the referenced secret", () => {
    expect(template).toContain(
      "AllowedPattern: '^arn:aws:secretsmanager:us-east-1:[0-9]{12}:secret:zc-e4-continuity-app-[A-Za-z0-9]{6}$'",
    );
    expect(template).toContain(
      "AllowedPattern: '^[0-9]{12}\\.dkr\\.ecr\\.us-east-1\\.amazonaws\\.com/zc-e4-continuity-demo@sha256:[a-f0-9]{64}$'",
    );
    expect(template).toContain("secretsmanager:GetSecretValue");
    expect(template).toContain("Resource: !Ref DatabaseSecretArn");
    expect(template).toContain("Resource: !Sub $" + "{LambdaLogGroup.Arn}:*");
    expect(template).toContain("amazon.titan-embed-text-v2:0");
    expect(template).toContain("amazon.nova-lite-v1:0");
    expect(template).not.toMatch(
      /bedrock:\*|bedrock:InvokeModelWithResponseStream|foundation-model\/\*/,
    );
    expect(template).not.toMatch(/SecretString|DATABASE_URL|AWS_ACCESS_KEY/);
    expect(template).not.toMatch(/aws-mcp:|AWSMcpServiceActionsFullAccess/);
  });

  it("keeps the site origin private and the API uncached", () => {
    expect(template).toContain("Type: AWS::CloudFront::OriginAccessControl");
    expect(template).toContain("BlockPublicPolicy: true");
    expect(template).toContain("VersioningConfiguration: { Status: Enabled }");
    expect(template).toContain("PathPattern: /api/*");
    expect(template).toContain("CookieBehavior: whitelist");
    expect(template).toContain("Cookies: [__Host-zc-session]");
    expect(template).toContain("QueryStringBehavior: none");
    expect(template).toContain("EnableAcceptEncodingBrotli: false");
    expect(template).toContain("EnableAcceptEncodingGzip: false");
    expect(template).not.toMatch(/EnableAcceptEncoding(?:Brotli|Gzip): true/);
    expect(template).not.toMatch(/Access-Control-Allow-Origin|AllowOrigin|CORS/);
  });

  it("documents the remaining public endpoint and alert limitations", () => {
    expect(readme).toContain("direct execute-api endpoint remains enabled, public");
    expect(readme).toContain("removing its `ApiUrl` output only stops advertising it");
    expect(readme).toContain("do not cover API Gateway-generated 404, 429, or 5xx responses");
    expect(readme).toContain("alert-only");
    expect(readme).toContain("evaluated daily with possible provider latency");
    expect(readme).toContain("depends on recipient email confirmation");
    expect(readme).toContain("required unreserved concurrency");
  });
});
