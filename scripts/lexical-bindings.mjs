import ts from "typescript";

function isScope(node) {
  return (
    ts.isBlock(node) ||
    ts.isCaseBlock(node) ||
    ts.isCatchClause(node) ||
    ts.isClassLike(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isFunctionLike(node) ||
    ts.isModuleBlock(node)
  );
}

function isFunctionScope(node) {
  return ts.isFunctionLike(node);
}

function bindingKind(declaration) {
  if (ts.isImportClause(declaration) || ts.isImportSpecifier(declaration)) return "import";
  if (ts.isNamespaceImport(declaration)) return "import";
  if (ts.isParameter(declaration)) return "parameter";
  if (ts.isCatchClause(declaration)) return "catch";
  if (ts.isFunctionDeclaration(declaration) || ts.isFunctionExpression(declaration))
    return "function";
  if (ts.isClassDeclaration(declaration) || ts.isClassExpression(declaration)) return "class";
  return "local";
}

export function isNameOnlyIdentifier(node) {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && parent.propertyName === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isMethodSignature(parent) && parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node) ||
    (ts.isImportSpecifier(parent) && parent.propertyName === node) ||
    (ts.isExportSpecifier(parent) && parent.propertyName === node)
  );
}

export function createLexicalBindings(sourceFile) {
  let nextBindingId = 1;
  const scopeForNode = new WeakMap();
  const declarationBinding = new WeakMap();
  const rootScope = {
    functionScope: true,
    names: new Map(),
    parent: undefined,
  };

  function addBinding(scope, identifier, declaration, options = {}) {
    const existing = scope.names.get(identifier.text);
    const record = existing ?? {
      declaration,
      id: nextBindingId++,
      initializer: undefined,
      isConst: false,
      kind: bindingKind(declaration),
      mutated: false,
    };
    if (options.initializer !== undefined) record.initializer = options.initializer;
    if (options.isConst === true) record.isConst = true;
    scope.names.set(identifier.text, record);
    declarationBinding.set(identifier, record);
    return record;
  }

  function addPattern(scope, pattern, declaration, options) {
    if (ts.isIdentifier(pattern)) {
      addBinding(scope, pattern, declaration, options);
      return;
    }
    for (const element of pattern.elements ?? []) {
      if (ts.isBindingElement(element)) addPattern(scope, element.name, declaration, options);
    }
  }

  function nearestFunction(scope) {
    let current = scope;
    while (current.parent && !current.functionScope) current = current.parent;
    return current;
  }

  function collect(node, inheritedScope) {
    let scope = inheritedScope;
    if (node !== sourceFile && isScope(node)) {
      scope = {
        functionScope: isFunctionScope(node),
        names: new Map(),
        parent: inheritedScope,
      };
    }
    scopeForNode.set(node, scope);

    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      addBinding(inheritedScope, node.name, node);
    }
    if ((ts.isFunctionExpression(node) || ts.isClassExpression(node)) && node.name) {
      addBinding(scope, node.name, node);
    }
    if (ts.isParameter(node)) {
      addPattern(scope, node.name, node, { initializer: node.initializer });
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      addPattern(scope, node.variableDeclaration.name, node, {});
    } else if (ts.isImportClause(node) && node.name) {
      addBinding(scope, node.name, node);
    } else if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) {
      addBinding(scope, node.name, node);
    } else if (ts.isImportEqualsDeclaration(node)) {
      addBinding(scope, node.name, node);
    } else if (ts.isVariableDeclaration(node) && !ts.isCatchClause(node.parent)) {
      const list = node.parent;
      const blockScoped =
        ts.isVariableDeclarationList(list) && Boolean(list.flags & ts.NodeFlags.BlockScoped);
      const target = blockScoped ? scope : nearestFunction(scope);
      addPattern(target, node.name, node, {
        initializer: ts.isIdentifier(node.name) ? node.initializer : undefined,
        isConst: ts.isVariableDeclarationList(list) && Boolean(list.flags & ts.NodeFlags.Const),
      });
    }
    ts.forEachChild(node, (child) => collect(child, scope));
  }

  collect(sourceFile, rootScope);

  function bindingOf(identifier) {
    const declared = declarationBinding.get(identifier);
    if (declared) return declared;
    let scope = scopeForNode.get(identifier) ?? rootScope;
    while (scope) {
      const binding = scope.names.get(identifier.text);
      if (binding) return binding;
      scope = scope.parent;
    }
    return undefined;
  }

  function assign(expression) {
    if (ts.isParenthesizedExpression(expression)) {
      assign(expression.expression);
      return;
    }
    if (ts.isIdentifier(expression)) {
      const binding = bindingOf(expression);
      if (binding) {
        binding.mutated = true;
      }
      return;
    }
    if (ts.isArrayLiteralExpression(expression)) {
      for (const element of expression.elements) assign(element);
      return;
    }
    if (ts.isObjectLiteralExpression(expression)) {
      for (const property of expression.properties) {
        if (ts.isShorthandPropertyAssignment(property)) assign(property.name);
        if (ts.isPropertyAssignment(property)) assign(property.initializer);
        if (ts.isSpreadAssignment(property)) assign(property.expression);
      }
    }
  }

  function collectWrites(node) {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    ) {
      assign(node.left);
    } else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)
    ) {
      assign(node.operand);
    }
    ts.forEachChild(node, collectWrites);
  }

  collectWrites(sourceFile);

  function unwrap(expression) {
    let current = expression;
    while (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isTypeAssertionExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current)
    ) {
      current = current.expression;
    }
    return current;
  }

  function constantString(expression, step, active = new Set()) {
    step();
    const current = unwrap(expression);
    if (ts.isStringLiteralLike(current)) return current.text;
    if (ts.isTemplateExpression(current)) {
      let value = current.head.text;
      for (const span of current.templateSpans) {
        const part = constantString(span.expression, step, active);
        if (part === undefined) return undefined;
        value += part + span.literal.text;
      }
      return value;
    }
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = constantString(current.left, step, active);
      const right = constantString(current.right, step, active);
      return left === undefined || right === undefined ? undefined : left + right;
    }
    if (ts.isIdentifier(current)) {
      const binding = bindingOf(current);
      if (
        !binding ||
        !binding.isConst ||
        binding.mutated ||
        !binding.initializer ||
        active.has(binding)
      )
        return undefined;
      active.add(binding);
      try {
        return constantString(binding.initializer, step, active);
      } finally {
        active.delete(binding);
      }
    }
    return undefined;
  }

  function referenceKey(identifier) {
    const binding = bindingOf(identifier);
    return binding ? `binding:${binding.id}` : `ambient:${identifier.text}`;
  }

  return {
    bindingOf,
    constantString,
    referenceKey,
    unwrap,
  };
}
