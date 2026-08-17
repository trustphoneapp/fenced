import path from "node:path";
import ts from "typescript";

export const executableSourceExtensions = Object.freeze([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

export function isExecutableSourcePath(filename) {
  return executableSourceExtensions.includes(path.extname(filename));
}

function scriptKind(filename) {
  const extension = path.extname(filename);
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if ([".cjs", ".js", ".mjs"].includes(extension)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function boundedInteger(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 4_194_304;
}

export function assertAstBudgets(value) {
  const exactJson =
    value !== null && typeof value === "object"
      ? `{"maxAstDepth":${value.maxAstDepth},"maxNodesPerFile":${value.maxNodesPerFile},"maxResolveStepsPerFile":${value.maxResolveStepsPerFile},"maxTokenNesting":${value.maxTokenNesting},"maxTokensPerFile":${value.maxTokensPerFile}}`
      : "";
  if (
    value === null ||
    typeof value !== "object" ||
    JSON.stringify(value) !== exactJson ||
    !boundedInteger(value.maxAstDepth) ||
    !boundedInteger(value.maxNodesPerFile) ||
    !boundedInteger(value.maxResolveStepsPerFile) ||
    !boundedInteger(value.maxTokenNesting) ||
    !boundedInteger(value.maxTokensPerFile)
  ) {
    throw new Error("source-security AST budget policy is invalid");
  }
}

export function preparseExecutableSource(text, filename, budgets, errorCodes) {
  assertAstBudgets(budgets);
  if (!isExecutableSourcePath(filename)) throw new Error(`${filename}:${errorCodes.parse}`);
  const kind = scriptKind(filename);
  const languageVariant =
    kind === ts.ScriptKind.JSX || kind === ts.ScriptKind.TSX
      ? ts.LanguageVariant.JSX
      : ts.LanguageVariant.Standard;

  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, languageVariant, text, undefined);
  const openingTokens = [
    ts.SyntaxKind.OpenBraceToken,
    ts.SyntaxKind.OpenBracketToken,
    ts.SyntaxKind.OpenParenToken,
  ];
  const closingTokens = [
    ts.SyntaxKind.CloseBraceToken,
    ts.SyntaxKind.CloseBracketToken,
    ts.SyntaxKind.CloseParenToken,
  ];
  let tokenCount = 0;
  let tokenNesting = 0;
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) {
    tokenCount += 1;
    const token = scanner.getToken();
    if (openingTokens.includes(token)) tokenNesting += 1;
    else if (closingTokens.includes(token)) tokenNesting = Math.max(0, tokenNesting - 1);
    if (tokenCount > budgets.maxTokensPerFile || tokenNesting > budgets.maxTokenNesting) {
      throw new Error(`${filename}:${errorCodes.budget}`);
    }
  }

  const sourceFile = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true, kind);
  if (sourceFile.parseDiagnostics.length > 0) {
    throw new Error(`${filename}:${errorCodes.parse}`);
  }

  const stack = [{ depth: 0, node: sourceFile }];
  let nodeCount = 0;
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;
    nodeCount += 1;
    if (nodeCount > budgets.maxNodesPerFile || frame.depth > budgets.maxAstDepth) {
      throw new Error(`${filename}:${errorCodes.budget}`);
    }
    ts.forEachChild(frame.node, (child) => {
      stack.push({ depth: frame.depth + 1, node: child });
    });
  }

  let resolutionSteps = 0;
  return {
    sourceFile,
    step() {
      resolutionSteps += 1;
      if (resolutionSteps > budgets.maxResolveStepsPerFile) {
        throw new Error(`${filename}:${errorCodes.budget}`);
      }
    },
  };
}
