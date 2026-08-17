import type {
  AuthenticatedServiceIdentity,
  PrincipalTenantContext,
  ResolvedMembership,
  SystemTenantContext,
  TenantContext,
  TenantWorkload,
} from "@zintus-continuity/domain";
import { membershipRoleAllowlist } from "./authentication.js";
import {
  lookupTenantAuthoritySourceState,
  type TenantAuthoritySource,
  type TenantAuthoritySourceState,
} from "./internal/tenant-authority-source-registry.js";

export const tenantContextLimits = Object.freeze({
  authorityJsonBytes: 4_096,
  identifierBytes: 128,
  idsJsonBytes: 512,
  issuedContexts: 1_024,
  roleCount: 3,
});

export type TenantContextDenialReason =
  | "ACTOR_DENIED"
  | "AUTHORITY_CHANGED"
  | "AUTHORITY_UNAVAILABLE"
  | "EXPIRED"
  | "FORGED_CONTEXT"
  | "FORGED_INTENT"
  | "INVALID_REQUEST"
  | "MALFORMED_AUTHORITY"
  | "REPLAY"
  | "ROLE_DENIED"
  | "WORKLOAD_DENIED";

export interface TenantContextDenied {
  readonly outcome: "denied";
  readonly reason: TenantContextDenialReason;
}

export interface TenantContextIssued {
  readonly context: TenantContext;
  readonly outcome: "issued";
}

export type TenantContextResult = TenantContextDenied | TenantContextIssued;
export type TenantAuthorityLookup = (serverIntent: unknown) => unknown;
export type TenantContextIdIssuer = () => unknown;
export type { TenantAuthoritySource };

export interface TenantAuthorityBinder {
  readonly kind: "tenant-authority-binder";
}

export interface TenantContextService {
  readonly issuePrincipal: (
    intent: unknown,
    membership: unknown,
    workload: unknown,
    serverNowEpochSeconds: unknown,
  ) => TenantContextResult;
  readonly issueSystem: (
    intent: unknown,
    origin: unknown,
    workload: unknown,
    serverNowEpochSeconds: unknown,
  ) => TenantContextResult;
  readonly validate: (context: unknown, serverNowEpochSeconds: unknown) => TenantContextResult;
}

interface ServiceProjection {
  readonly clientId: string;
  readonly issuer: string;
  readonly provider: "service";
  readonly subject: string;
}

interface WorkloadProjection extends ServiceProjection {
  readonly capability: string;
  readonly classification: string;
}

interface AuthorityCommon {
  readonly expiresAtSeconds: number;
  readonly intentId: string;
  readonly mode: "principal" | "system";
  readonly operation: string;
  readonly purpose: string;
  readonly revoked: boolean;
  readonly tenantAuthorizationEpoch: number;
  readonly tenantAuthorityRevision: number;
  readonly tenantFence: string;
  readonly tenantId: string;
  readonly version: "tenant-context.v1";
  readonly workload: WorkloadProjection;
}

interface PrincipalAuthority extends AuthorityCommon {
  readonly allowedRoles: readonly string[];
  readonly mode: "principal";
}

interface SystemAuthority extends AuthorityCommon {
  readonly mode: "system";
  readonly systemOrigin: ServiceProjection;
}

type TenantAuthority = PrincipalAuthority | SystemAuthority;

interface ContextBinding {
  readonly authorityJson: string;
  readonly authorityGeneration: object;
  readonly binder: TenantAuthorityBinder;
  readonly intent: unknown;
  readonly membership?: ResolvedMembership;
  readonly origin?: AuthenticatedServiceIdentity;
  readonly workload: AuthenticatedServiceIdentity;
}

type BinderState = TenantAuthoritySourceState;

const plainObjectPrototype = Object.getPrototypeOf({});
const lookupFailed = Object.freeze({});
const binderStates = new WeakMap<object, BinderState>();
const binderReplayStates = new WeakMap<
  object,
  { issuedContexts: number; readonly usedIds: Set<string> }
>();
const authorityBindings = new WeakMap<object, TenantAuthorityBinder>();

interface TenantContextIds {
  readonly decisionId: string;
  readonly requestId: string;
  readonly traceId: string;
}

function denied(reason: TenantContextDenialReason): TenantContextDenied {
  return Object.freeze({ outcome: "denied", reason });
}

function safeSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function utf8BytesWithin(value: string, maximum: number): boolean {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit <= 0x7f) bytes += 1;
    else if (unit <= 0x7ff) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      bytes += 4;
      index += 1;
    } else {
      if (unit >= 0xdc00 && unit <= 0xdfff) return false;
      bytes += 3;
    }
    if (bytes > maximum) return false;
  }
  return true;
}

function identifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,127}$/u.test(value) &&
    !value.includes("..") &&
    utf8BytesWithin(value, tenantContextLimits.identifierBytes)
  );
}

function exactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === plainObjectPrototype &&
    Object.keys(value).length === expected.length &&
    Object.keys(value).every((key) => expected.includes(key))
  );
}

function parseServiceProjection(value: unknown): ServiceProjection | undefined {
  if (!exactKeys(value, ["clientId", "issuer", "provider", "subject"])) return undefined;
  if (
    !identifier(value.clientId) ||
    !identifier(value.issuer) ||
    value.provider !== "service" ||
    !identifier(value.subject)
  )
    return undefined;
  return value as unknown as ServiceProjection;
}

function parseWorkload(value: unknown): WorkloadProjection | undefined {
  if (
    !exactKeys(value, [
      "capability",
      "classification",
      "clientId",
      "issuer",
      "provider",
      "subject",
    ]) ||
    !identifier(value.capability) ||
    !identifier(value.classification)
  )
    return undefined;
  const service = parseServiceProjection({
    clientId: value.clientId,
    issuer: value.issuer,
    provider: value.provider,
    subject: value.subject,
  });
  return service ? (value as unknown as WorkloadProjection) : undefined;
}

function canonicalService(value: ServiceProjection): string {
  return JSON.stringify({
    clientId: value.clientId,
    issuer: value.issuer,
    provider: value.provider,
    subject: value.subject,
  });
}

function canonicalWorkload(value: WorkloadProjection): string {
  return JSON.stringify({
    capability: value.capability,
    classification: value.classification,
    clientId: value.clientId,
    issuer: value.issuer,
    provider: value.provider,
    subject: value.subject,
  });
}

function canonicalAuthority(value: TenantAuthority): string {
  const common = `"expiresAtSeconds":${String(value.expiresAtSeconds)},"intentId":${JSON.stringify(value.intentId)},"mode":${JSON.stringify(value.mode)},"operation":${JSON.stringify(value.operation)},"purpose":${JSON.stringify(value.purpose)},"revoked":${String(value.revoked)},`;
  const tenant = `"tenantAuthorizationEpoch":${String(value.tenantAuthorizationEpoch)},"tenantAuthorityRevision":${String(value.tenantAuthorityRevision)},"tenantFence":${JSON.stringify(value.tenantFence)},"tenantId":${JSON.stringify(value.tenantId)},"version":"tenant-context.v1","workload":${canonicalWorkload(value.workload)}`;
  return value.mode === "principal"
    ? `{"allowedRoles":${JSON.stringify(value.allowedRoles)},${common}${tenant}}`
    : `{${common}"systemOrigin":${canonicalService(value.systemOrigin)},${tenant}}`;
}

function parseAuthority(value: unknown): TenantAuthority | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !utf8BytesWithin(value, tenantContextLimits.authorityJsonBytes)
  )
    return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  const mode = record.mode;
  const keys =
    mode === "principal"
      ? [
          "allowedRoles",
          "expiresAtSeconds",
          "intentId",
          "mode",
          "operation",
          "purpose",
          "revoked",
          "tenantAuthorizationEpoch",
          "tenantAuthorityRevision",
          "tenantFence",
          "tenantId",
          "version",
          "workload",
        ]
      : [
          "expiresAtSeconds",
          "intentId",
          "mode",
          "operation",
          "purpose",
          "revoked",
          "systemOrigin",
          "tenantAuthorizationEpoch",
          "tenantAuthorityRevision",
          "tenantFence",
          "tenantId",
          "version",
          "workload",
        ];
  if (
    (mode !== "principal" && mode !== "system") ||
    !exactKeys(record, keys) ||
    !safeSeconds(record.expiresAtSeconds) ||
    !identifier(record.intentId) ||
    !identifier(record.operation) ||
    !identifier(record.purpose) ||
    typeof record.revoked !== "boolean" ||
    !safeSeconds(record.tenantAuthorizationEpoch) ||
    record.tenantAuthorizationEpoch === 0 ||
    !safeSeconds(record.tenantAuthorityRevision) ||
    record.tenantAuthorityRevision === 0 ||
    !identifier(record.tenantFence) ||
    !identifier(record.tenantId) ||
    record.version !== "tenant-context.v1"
  )
    return undefined;
  const workload = parseWorkload(record.workload);
  if (!workload) return undefined;
  let authority: TenantAuthority;
  if (mode === "principal") {
    const roles = record.allowedRoles;
    if (
      !Array.isArray(roles) ||
      roles.length === 0 ||
      roles.length > tenantContextLimits.roleCount ||
      !roles.every(
        (role, index) =>
          typeof role === "string" &&
          membershipRoleAllowlist.includes(role as (typeof membershipRoleAllowlist)[number]) &&
          (index === 0 || (roles.at(index - 1) as string) < role),
      )
    )
      return undefined;
    authority = { ...(record as unknown as PrincipalAuthority), workload };
  } else {
    const systemOrigin = parseServiceProjection(record.systemOrigin);
    if (!systemOrigin) return undefined;
    authority = { ...(record as unknown as SystemAuthority), systemOrigin, workload };
  }
  return canonicalAuthority(authority) === value ? authority : undefined;
}

function lookupAuthority(lookup: TenantAuthorityLookup, intent: unknown): unknown {
  try {
    return lookup(intent);
  } catch {
    return lookupFailed;
  }
}

function parseIds(value: unknown): TenantContextIds | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !utf8BytesWithin(value, tenantContextLimits.idsJsonBytes)
  )
    return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (!exactKeys(parsed, ["decisionId", "requestId", "traceId"])) return undefined;
  if (
    !identifier(parsed.decisionId) ||
    !identifier(parsed.requestId) ||
    !identifier(parsed.traceId) ||
    parsed.requestId === parsed.traceId ||
    parsed.requestId === parsed.decisionId ||
    parsed.traceId === parsed.decisionId
  )
    return undefined;
  const ids = parsed as unknown as TenantContextIds;
  return JSON.stringify(ids) === value ? ids : undefined;
}

function serviceMatches(
  service: AuthenticatedServiceIdentity,
  projection: ServiceProjection,
): boolean {
  return (
    service.identity.clientId === projection.clientId &&
    service.identity.issuer === projection.issuer &&
    service.identity.provider === projection.provider &&
    service.identity.subject === projection.subject
  );
}

function membershipMatches(left: ResolvedMembership, right: ResolvedMembership): boolean {
  return (
    left.principal === right.principal &&
    left.assurance === right.assurance &&
    left.authorityRevision === right.authorityRevision &&
    left.effectiveExpiresAtSeconds === right.effectiveExpiresAtSeconds &&
    left.membershipEpoch === right.membershipEpoch &&
    left.membershipId === right.membershipId &&
    left.tenantId === right.tenantId &&
    left.roles.length === right.roles.length &&
    left.roles.every((role, index) => role === right.roles.at(index))
  );
}

function generation(reader: () => unknown): object | undefined {
  try {
    const value = reader();
    return value !== null && typeof value === "object" ? value : undefined;
  } catch {
    return undefined;
  }
}

export function createTenantAuthorityBinder(source: TenantAuthoritySource): TenantAuthorityBinder {
  const state = lookupTenantAuthoritySourceState(source);
  if (!state || !generation(state.readGeneration))
    throw new Error("INVALID_TENANT_AUTHORITY_BINDER_CONFIGURATION");
  const binder: TenantAuthorityBinder = Object.freeze({ kind: "tenant-authority-binder" });
  binderStates.set(binder, state);
  return binder;
}

export function createTenantContextService(
  binder: TenantAuthorityBinder,
  idIssuer: TenantContextIdIssuer,
): TenantContextService {
  const configuredBinderState =
    binder !== null && typeof binder === "object" ? binderStates.get(binder) : undefined;
  if (!configuredBinderState || typeof idIssuer !== "function")
    throw new Error("INVALID_TENANT_CONTEXT_CONFIGURATION");
  const binderState = configuredBinderState;
  const configuredReplayState = binderReplayStates.get(binder);
  const replayState = configuredReplayState ?? {
    issuedContexts: 0,
    usedIds: new Set<string>(),
  };
  if (!configuredReplayState) binderReplayStates.set(binder, replayState);
  const contexts = new WeakMap<object, ContextBinding>();
  const invalidated = new WeakSet<object>();

  function captureGeneration(): object | TenantContextDenied {
    return generation(binderState.readGeneration) ?? denied("AUTHORITY_CHANGED");
  }

  function generationUnchanged(captured: object): boolean {
    return generation(binderState.readGeneration) === captured;
  }

  function readAuthority(
    intent: unknown,
  ): { readonly authority: TenantAuthority; readonly json: string } | TenantContextDenied {
    const found = lookupAuthority(binderState.tenantLookup, intent);
    if (found === lookupFailed) return denied("AUTHORITY_UNAVAILABLE");
    if (found === undefined) return denied("FORGED_INTENT");
    const authority = parseAuthority(found);
    if (!authority) return denied("MALFORMED_AUTHORITY");
    if (authority.revoked) return denied("AUTHORITY_CHANGED");
    return { authority, json: found as string };
  }

  function idsUnused(requestId: string, traceId: string, decisionId: string): boolean {
    return (
      !replayState.usedIds.has(requestId) &&
      !replayState.usedIds.has(traceId) &&
      !replayState.usedIds.has(decisionId)
    );
  }

  function reserveIds(requestId: string, traceId: string, decisionId: string): void {
    replayState.usedIds.add(requestId);
    replayState.usedIds.add(traceId);
    replayState.usedIds.add(decisionId);
    replayState.issuedContexts += 1;
  }

  function nextIds(): TenantContextIds | TenantContextDenied {
    let value: unknown;
    try {
      value = idIssuer();
    } catch {
      return denied("INVALID_REQUEST");
    }
    const ids = parseIds(value);
    if (!ids) return denied("INVALID_REQUEST");
    if (!idsUnused(ids.requestId, ids.traceId, ids.decisionId)) return denied("REPLAY");
    return ids;
  }

  function verifiedService(
    candidate: unknown,
    projection: ServiceProjection,
    now: number,
  ): AuthenticatedServiceIdentity | undefined {
    const result = binderState.authentication.validateService(candidate, now);
    return result.outcome === "verified" && serviceMatches(result.service, projection)
      ? result.service
      : undefined;
  }

  function workloadFor(
    candidate: unknown,
    projection: WorkloadProjection,
    now: number,
  ): TenantWorkload | undefined {
    const service = verifiedService(candidate, projection, now);
    return service
      ? Object.freeze({
          capability: projection.capability,
          classification: projection.classification,
          service,
        })
      : undefined;
  }

  function bindContext(context: TenantContext, binding: ContextBinding): TenantContextResult {
    if (!idsUnused(context.requestId, context.traceId, context.decisionId)) return denied("REPLAY");
    if (replayState.issuedContexts >= tenantContextLimits.issuedContexts)
      return denied("INVALID_REQUEST");
    const frozenBinding = Object.freeze(binding);
    authorityBindings.set(frozenBinding, binder);
    contexts.set(context, frozenBinding);
    reserveIds(context.requestId, context.traceId, context.decisionId);
    return Object.freeze({ context, outcome: "issued" });
  }

  function common(
    authority: TenantAuthority,
    workload: TenantWorkload,
    requestId: string,
    traceId: string,
    decisionId: string,
    issuedAtSeconds: number,
    actorExpiry: number,
  ) {
    return {
      decisionId,
      effectiveExpiresAtSeconds: Math.min(
        authority.expiresAtSeconds,
        actorExpiry,
        workload.service.session.expiresAtSeconds,
      ),
      issuedAtSeconds,
      operation: authority.operation,
      purpose: authority.purpose,
      requestId,
      tenantAuthorizationEpoch: authority.tenantAuthorizationEpoch,
      tenantAuthorityRevision: authority.tenantAuthorityRevision,
      tenantFence: authority.tenantFence,
      tenantId: authority.tenantId,
      traceId,
      version: authority.version,
      workload,
    } as const;
  }

  function invalidate(context: object, reason: TenantContextDenialReason): TenantContextDenied {
    invalidated.add(context);
    return denied(reason);
  }

  return Object.freeze({
    issuePrincipal(
      intent: unknown,
      membership: unknown,
      workloadCandidate: unknown,
      serverNowEpochSeconds: unknown,
    ): TenantContextResult {
      if (!safeSeconds(serverNowEpochSeconds)) return denied("INVALID_REQUEST");
      if (replayState.issuedContexts >= tenantContextLimits.issuedContexts)
        return denied("INVALID_REQUEST");
      const ids = nextIds();
      if ("outcome" in ids) return ids;
      const capturedGeneration = captureGeneration();
      if ("outcome" in capturedGeneration) return capturedGeneration;
      const read = readAuthority(intent);
      if ("outcome" in read) return read;
      const authority = read.authority;
      if (authority.mode !== "principal") return denied("ACTOR_DENIED");
      if (authority.expiresAtSeconds <= serverNowEpochSeconds) return denied("EXPIRED");
      const membershipResult = binderState.authentication.validateMembership(
        membership,
        serverNowEpochSeconds,
      );
      if (membershipResult.outcome !== "resolved") return denied("ACTOR_DENIED");
      const currentMembership = membershipResult.membership;
      if (
        currentMembership.tenantId !== authority.tenantId ||
        !authority.allowedRoles.some((role) => currentMembership.roles.includes(role))
      )
        return denied("ROLE_DENIED");
      const workload = workloadFor(workloadCandidate, authority.workload, serverNowEpochSeconds);
      if (!workload) return denied("WORKLOAD_DENIED");
      if (!generationUnchanged(capturedGeneration)) return denied("AUTHORITY_CHANGED");
      const shared = common(
        authority,
        workload,
        ids.requestId,
        ids.traceId,
        ids.decisionId,
        serverNowEpochSeconds,
        currentMembership.effectiveExpiresAtSeconds,
      );
      if (shared.effectiveExpiresAtSeconds <= serverNowEpochSeconds) return denied("EXPIRED");
      const context: PrincipalTenantContext = Object.freeze({
        ...shared,
        membership: currentMembership,
        mode: "principal",
      });
      return bindContext(context, {
        authorityJson: read.json,
        authorityGeneration: capturedGeneration,
        binder,
        intent,
        membership: currentMembership,
        workload: workload.service,
      });
    },
    issueSystem(
      intent: unknown,
      originCandidate: unknown,
      workloadCandidate: unknown,
      serverNowEpochSeconds: unknown,
    ): TenantContextResult {
      if (!safeSeconds(serverNowEpochSeconds)) return denied("INVALID_REQUEST");
      if (replayState.issuedContexts >= tenantContextLimits.issuedContexts)
        return denied("INVALID_REQUEST");
      const ids = nextIds();
      if ("outcome" in ids) return ids;
      const capturedGeneration = captureGeneration();
      if ("outcome" in capturedGeneration) return capturedGeneration;
      const read = readAuthority(intent);
      if ("outcome" in read) return read;
      const authority = read.authority;
      if (authority.mode !== "system") return denied("ACTOR_DENIED");
      if (authority.expiresAtSeconds <= serverNowEpochSeconds) return denied("EXPIRED");
      const origin = verifiedService(
        originCandidate,
        authority.systemOrigin,
        serverNowEpochSeconds,
      );
      if (!origin) return denied("ACTOR_DENIED");
      const workload = workloadFor(workloadCandidate, authority.workload, serverNowEpochSeconds);
      if (!workload) return denied("WORKLOAD_DENIED");
      if (!generationUnchanged(capturedGeneration)) return denied("AUTHORITY_CHANGED");
      const shared = common(
        authority,
        workload,
        ids.requestId,
        ids.traceId,
        ids.decisionId,
        serverNowEpochSeconds,
        origin.session.expiresAtSeconds,
      );
      if (shared.effectiveExpiresAtSeconds <= serverNowEpochSeconds) return denied("EXPIRED");
      const context: SystemTenantContext = Object.freeze({
        ...shared,
        mode: "system",
        origin,
      });
      return bindContext(context, {
        authorityJson: read.json,
        authorityGeneration: capturedGeneration,
        binder,
        intent,
        origin,
        workload: workload.service,
      });
    },
    validate(context: unknown, serverNowEpochSeconds: unknown): TenantContextResult {
      if (context === null || typeof context !== "object" || !contexts.has(context))
        return denied("FORGED_CONTEXT");
      if (invalidated.has(context)) return denied("AUTHORITY_CHANGED");
      if (!safeSeconds(serverNowEpochSeconds)) return invalidate(context, "INVALID_REQUEST");
      const issued = context as TenantContext;
      if (issued.effectiveExpiresAtSeconds <= serverNowEpochSeconds)
        return invalidate(context, "EXPIRED");
      const binding = contexts.get(context) as ContextBinding;
      if (
        authorityBindings.get(binding) !== binder ||
        !generationUnchanged(binding.authorityGeneration)
      )
        return invalidate(context, "AUTHORITY_CHANGED");
      const read = readAuthority(binding.intent);
      if ("outcome" in read) return invalidate(context, read.reason);
      if (read.json !== binding.authorityJson) return invalidate(context, "AUTHORITY_CHANGED");
      const workload = verifiedService(
        binding.workload,
        read.authority.workload,
        serverNowEpochSeconds,
      );
      if (!workload) return invalidate(context, "WORKLOAD_DENIED");
      if (issued.mode === "principal") {
        if (read.authority.mode !== "principal" || !binding.membership)
          return invalidate(context, "AUTHORITY_CHANGED");
        const membershipResult = binderState.authentication.validateMembership(
          binding.membership,
          serverNowEpochSeconds,
        );
        if (
          membershipResult.outcome !== "resolved" ||
          !membershipMatches(membershipResult.membership, issued.membership)
        )
          return invalidate(context, "ACTOR_DENIED");
      } else {
        if (
          read.authority.mode !== "system" ||
          !binding.origin ||
          !serviceMatches(binding.origin, read.authority.systemOrigin) ||
          binderState.authentication.validateService(binding.origin, serverNowEpochSeconds)
            .outcome !== "verified"
        )
          return invalidate(context, "ACTOR_DENIED");
      }
      if (!generationUnchanged(binding.authorityGeneration))
        return invalidate(context, "AUTHORITY_CHANGED");
      return Object.freeze({ context: issued, outcome: "issued" });
    },
  });
}
