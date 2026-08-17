import {
  type AuthenticatedPrincipal,
  type AuthenticatedServiceIdentity,
  type CredentialIdentity,
  cognitoIdentityProvider,
  type ResolvedMembership,
  serviceIdentityProvider,
} from "@zintus-continuity/domain";

export const authenticationLimits = Object.freeze({
  authorityJsonBytes: 16_384,
  clientIdBytes: 128,
  clockSkewSeconds: 300,
  credentialIdBytes: 256,
  issuerBytes: 512,
  membershipCount: 8,
  membershipIdBytes: 128,
  projectionJsonBytes: 1_149,
  roleCount: 3,
  serviceProjectionJsonBytes: 1_104,
  subjectBytes: 256,
  tenantIdBytes: 128,
});

export const membershipRoleAllowlist = Object.freeze([
  "member",
  "operator",
  "tenant_admin",
] as const);

export type AuthenticationDenialReason =
  | "CLIENT_ID_MISMATCH"
  | "EXPIRED"
  | "INVALID_SERVER_CONFIGURATION"
  | "ISSUER_MISMATCH"
  | "MALFORMED_PROJECTION"
  | "NOT_YET_ACTIVE"
  | "TOKEN_USE_MISMATCH"
  | "VERIFICATION_FAILED";

export type IdentityAuthorityDenialReason =
  | "AUTHORITY_UNAVAILABLE"
  | "CREDENTIAL_REVOKED"
  | "CREDENTIAL_STALE"
  | "CREDENTIAL_UNKNOWN"
  | "EXPIRED"
  | "FORGED_IDENTITY"
  | "HINT_MISMATCH"
  | "INVALID_REQUEST"
  | "MALFORMED_AUTHORITY"
  | "MEMBERSHIP_AMBIGUOUS"
  | "MEMBERSHIP_EPOCH_MISMATCH"
  | "MEMBERSHIP_REVOKED"
  | "MEMBERSHIP_UNKNOWN"
  | "SERVICE_REVOKED";

export interface AuthenticationDenied {
  readonly outcome: "denied";
  readonly reason: AuthenticationDenialReason;
}

export interface AuthenticationVerified {
  readonly outcome: "verified";
  readonly principal: AuthenticatedPrincipal;
}

export type AuthenticationResult = AuthenticationDenied | AuthenticationVerified;

export interface IdentityAuthorityDenied {
  readonly outcome: "denied";
  readonly reason: IdentityAuthorityDenialReason;
}

export interface MembershipResolved {
  readonly membership: ResolvedMembership;
  readonly outcome: "resolved";
}

export type MembershipResult = IdentityAuthorityDenied | MembershipResolved;

export interface ServiceIdentityVerified {
  readonly outcome: "verified";
  readonly service: AuthenticatedServiceIdentity;
}

export type ServiceIdentityResult = IdentityAuthorityDenied | ServiceIdentityVerified;

export type IdentityAuthorityLookup = (credentialIdentityKey: string) => unknown;

export interface AuthenticationService {
  readonly authenticate: (
    verifiedProjection: unknown,
    serverNowEpochSeconds: unknown,
  ) => AuthenticationResult;
  readonly authenticateService: (
    verifiedProjection: unknown,
    serverNowEpochSeconds: unknown,
  ) => ServiceIdentityResult;
  readonly resolveMembership: (
    principal: unknown,
    tenantHint: unknown,
    expectedMembershipEpoch: unknown,
    serverNowEpochSeconds: unknown,
  ) => MembershipResult;
  readonly validateMembership: (
    membership: unknown,
    serverNowEpochSeconds: unknown,
  ) => MembershipResult;
  readonly validateService: (
    service: unknown,
    serverNowEpochSeconds: unknown,
  ) => ServiceIdentityResult;
}

interface ParsedProjection {
  readonly authenticationMethods: readonly string[];
  readonly authenticatedAtSeconds: number;
  readonly clientId: string;
  readonly credentialId: string;
  readonly expiresAtSeconds: number;
  readonly issuedAtSeconds: number;
  readonly issuer: string;
  readonly provider: string;
  readonly subject: string;
  readonly tokenUse: string;
}

interface MembershipProjection {
  readonly clientId: string;
  readonly expiresAtSeconds: number;
  readonly issuer: string;
  readonly membershipEpoch: number;
  readonly membershipId: string;
  readonly provider: string;
  readonly revoked: boolean;
  readonly roles: readonly string[];
  readonly subject: string;
  readonly tenantId: string;
}

interface CredentialAuthorityProjection {
  readonly clientId: string;
  readonly credentialId: string;
  readonly issuer: string;
  readonly provider: string;
  readonly revoked: boolean;
  readonly subject: string;
  readonly validAfterSeconds: number;
}

interface IdentityAuthoritySnapshot {
  readonly authorityRevision: number;
  readonly credential: CredentialAuthorityProjection;
  readonly memberships: readonly MembershipProjection[];
}

interface ServiceProjection {
  readonly clientId: string;
  readonly expiresAtSeconds: number;
  readonly issuedAtSeconds: number;
  readonly issuer: string;
  readonly provider: string;
  readonly subject: string;
}

interface ServiceAuthorityProjection extends ServiceProjection {
  readonly revoked: boolean;
}

const plainObjectPrototype = Object.getPrototypeOf({});
function denial(reason: AuthenticationDenialReason): AuthenticationDenied {
  return Object.freeze({ outcome: "denied", reason });
}

function authorityDenial(reason: IdentityAuthorityDenialReason): IdentityAuthorityDenied {
  return Object.freeze({ outcome: "denied", reason });
}

function utf8BytesWithin(value: string, maximum: number): number | undefined {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit <= 0x7f) bytes += 1;
    else if (unit <= 0x7ff) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return undefined;
      bytes += 4;
      index += 1;
    } else {
      if (unit >= 0xdc00 && unit <= 0xdfff) return undefined;
      bytes += 3;
    }
    if (bytes > maximum) return undefined;
  }
  return bytes;
}

function isBoundedVisibleAscii(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumBytes &&
    /^[\x21-\x7e]+$/u.test(value)
  );
}

function isSafeSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function canonicalProjection(value: ParsedProjection): string {
  return JSON.stringify({
    authenticationMethods: value.authenticationMethods,
    authenticatedAtSeconds: value.authenticatedAtSeconds,
    clientId: value.clientId,
    credentialId: value.credentialId,
    expiresAtSeconds: value.expiresAtSeconds,
    issuedAtSeconds: value.issuedAtSeconds,
    issuer: value.issuer,
    provider: value.provider,
    subject: value.subject,
    tokenUse: value.tokenUse,
  });
}

function assuranceFor(authenticationMethods: readonly string[]) {
  if (authenticationMethods.length === 1 && authenticationMethods.at(0) === "pwd")
    return "single_factor" as const;
  if (
    authenticationMethods.length === 2 &&
    authenticationMethods.at(0) === "mfa" &&
    authenticationMethods.at(1) === "pwd"
  )
    return "multi_factor" as const;
  return undefined;
}

function parseProjection(value: unknown): ParsedProjection | undefined {
  if (typeof value !== "string") return undefined;
  const byteLength = utf8BytesWithin(value, authenticationLimits.projectionJsonBytes);
  if (byteLength === undefined || byteLength === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return undefined;
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.getPrototypeOf(parsed) !== plainObjectPrototype
  )
    return undefined;
  const projection = parsed as Readonly<Record<string, unknown>>;
  if (
    !Array.isArray(projection.authenticationMethods) ||
    assuranceFor(projection.authenticationMethods) === undefined ||
    typeof projection.provider !== "string" ||
    typeof projection.tokenUse !== "string" ||
    !isBoundedVisibleAscii(projection.issuer, authenticationLimits.issuerBytes) ||
    !isBoundedVisibleAscii(projection.subject, authenticationLimits.subjectBytes) ||
    !isBoundedVisibleAscii(projection.clientId, authenticationLimits.clientIdBytes) ||
    !isBoundedVisibleAscii(projection.credentialId, authenticationLimits.credentialIdBytes) ||
    !isSafeSeconds(projection.issuedAtSeconds) ||
    !isSafeSeconds(projection.expiresAtSeconds) ||
    !isSafeSeconds(projection.authenticatedAtSeconds)
  )
    return undefined;
  const result = projection as unknown as ParsedProjection;
  return canonicalProjection(result) === value ? result : undefined;
}

function verifiedPrincipal(projection: ParsedProjection): AuthenticationVerified {
  const assurance = assuranceFor(projection.authenticationMethods);
  if (!assurance) throw new Error("INVALID_VERIFIED_AUTHENTICATION_METHODS");
  const identity = Object.freeze({
    clientId: projection.clientId,
    issuer: projection.issuer,
    provider: cognitoIdentityProvider,
    subject: projection.subject,
  });
  const session = Object.freeze({
    assurance,
    authenticatedAtSeconds: projection.authenticatedAtSeconds,
    credentialId: projection.credentialId,
    expiresAtSeconds: projection.expiresAtSeconds,
    issuedAtSeconds: projection.issuedAtSeconds,
  });
  const principal: AuthenticatedPrincipal = Object.freeze({
    identity,
    session,
  });
  return Object.freeze({ outcome: "verified", principal });
}

function credentialIdentityKey(identity: CredentialIdentity): string {
  return JSON.stringify({
    clientId: identity.clientId,
    issuer: identity.issuer,
    provider: identity.provider,
    subject: identity.subject,
  });
}

function principalCredentialKey(principal: AuthenticatedPrincipal): string {
  return JSON.stringify({
    clientId: principal.identity.clientId,
    credentialId: principal.session.credentialId,
    issuer: principal.identity.issuer,
    provider: principal.identity.provider,
    subject: principal.identity.subject,
  });
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === plainObjectPrototype
  );
}

function parseJsonRecord(value: unknown, maximumBytes: number) {
  if (typeof value !== "string") return undefined;
  const byteLength = utf8BytesWithin(value, maximumBytes);
  if (byteLength === undefined || byteLength === 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isPlainRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function canonicalMembership(value: MembershipProjection): string {
  return JSON.stringify({
    clientId: value.clientId,
    expiresAtSeconds: value.expiresAtSeconds,
    issuer: value.issuer,
    membershipEpoch: value.membershipEpoch,
    membershipId: value.membershipId,
    provider: value.provider,
    revoked: value.revoked,
    roles: value.roles,
    subject: value.subject,
    tenantId: value.tenantId,
  });
}

function parseMembership(value: unknown): MembershipProjection | undefined {
  if (!isPlainRecord(value)) return undefined;
  const roles = value.roles;
  if (
    !isBoundedVisibleAscii(value.clientId, authenticationLimits.clientIdBytes) ||
    !isSafeSeconds(value.expiresAtSeconds) ||
    !isBoundedVisibleAscii(value.issuer, authenticationLimits.issuerBytes) ||
    !isSafeSeconds(value.membershipEpoch) ||
    value.membershipEpoch === 0 ||
    !isBoundedVisibleAscii(value.membershipId, authenticationLimits.membershipIdBytes) ||
    typeof value.provider !== "string" ||
    typeof value.revoked !== "boolean" ||
    !Array.isArray(roles) ||
    roles.length === 0 ||
    roles.length > authenticationLimits.roleCount ||
    !roles.every(
      (role, index) =>
        typeof role === "string" &&
        membershipRoleAllowlist.includes(role as (typeof membershipRoleAllowlist)[number]) &&
        (index === 0 || (roles.at(index - 1) as string) < role),
    ) ||
    !isBoundedVisibleAscii(value.subject, authenticationLimits.subjectBytes) ||
    !isBoundedVisibleAscii(value.tenantId, authenticationLimits.tenantIdBytes)
  )
    return undefined;
  const projection = value as unknown as MembershipProjection;
  return canonicalMembership(projection) === JSON.stringify(value) ? projection : undefined;
}

function parseMemberships(value: unknown): readonly MembershipProjection[] | undefined {
  if (!Array.isArray(value) || value.length > authenticationLimits.membershipCount)
    return undefined;
  const memberships: MembershipProjection[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const membership = parseMembership(value.at(index));
    if (!membership) return undefined;
    memberships.push(membership);
  }
  return memberships;
}

function canonicalCredentialAuthority(value: CredentialAuthorityProjection): string {
  return JSON.stringify({
    clientId: value.clientId,
    credentialId: value.credentialId,
    issuer: value.issuer,
    provider: value.provider,
    revoked: value.revoked,
    subject: value.subject,
    validAfterSeconds: value.validAfterSeconds,
  });
}

function parseCredentialAuthority(value: unknown): CredentialAuthorityProjection | undefined {
  const record = isPlainRecord(value) ? value : undefined;
  if (
    !record ||
    !isBoundedVisibleAscii(record.clientId, authenticationLimits.clientIdBytes) ||
    !isBoundedVisibleAscii(record.credentialId, authenticationLimits.credentialIdBytes) ||
    !isBoundedVisibleAscii(record.issuer, authenticationLimits.issuerBytes) ||
    typeof record.provider !== "string" ||
    typeof record.revoked !== "boolean" ||
    !isBoundedVisibleAscii(record.subject, authenticationLimits.subjectBytes) ||
    !isSafeSeconds(record.validAfterSeconds)
  )
    return undefined;
  const projection = record as unknown as CredentialAuthorityProjection;
  return canonicalCredentialAuthority(projection) === JSON.stringify(value)
    ? projection
    : undefined;
}

function parseIdentityAuthoritySnapshot(value: unknown): IdentityAuthoritySnapshot | undefined {
  const root = parseJsonRecord(value, authenticationLimits.authorityJsonBytes);
  if (!root || !isSafeSeconds(root.authorityRevision) || root.authorityRevision === 0)
    return undefined;
  const credential = parseCredentialAuthority(root.credential);
  const memberships = parseMemberships(root.memberships);
  if (!credential || !memberships) return undefined;
  const canonical = `{"authorityRevision":${String(root.authorityRevision)},"credential":${canonicalCredentialAuthority(credential)},"memberships":[${memberships.map(canonicalMembership).join(",")}]}`;
  if (canonical !== value) return undefined;
  return {
    authorityRevision: root.authorityRevision,
    credential,
    memberships,
  };
}

function canonicalService(value: ServiceProjection): string {
  return JSON.stringify({
    clientId: value.clientId,
    expiresAtSeconds: value.expiresAtSeconds,
    issuedAtSeconds: value.issuedAtSeconds,
    issuer: value.issuer,
    provider: value.provider,
    subject: value.subject,
  });
}

function parseService(value: unknown): ServiceProjection | undefined {
  const record = parseJsonRecord(value, authenticationLimits.serviceProjectionJsonBytes);
  if (
    !record ||
    !isBoundedVisibleAscii(record.clientId, authenticationLimits.clientIdBytes) ||
    !isSafeSeconds(record.expiresAtSeconds) ||
    !isSafeSeconds(record.issuedAtSeconds) ||
    !isBoundedVisibleAscii(record.issuer, authenticationLimits.issuerBytes) ||
    typeof record.provider !== "string" ||
    !isBoundedVisibleAscii(record.subject, authenticationLimits.subjectBytes)
  )
    return undefined;
  const projection = record as unknown as ServiceProjection;
  return canonicalService(projection) === value ? projection : undefined;
}

function canonicalServiceAuthority(value: ServiceAuthorityProjection): string {
  return JSON.stringify({
    clientId: value.clientId,
    expiresAtSeconds: value.expiresAtSeconds,
    issuedAtSeconds: value.issuedAtSeconds,
    issuer: value.issuer,
    provider: value.provider,
    revoked: value.revoked,
    subject: value.subject,
  });
}

function parseServiceAuthority(value: unknown): ServiceAuthorityProjection | undefined {
  const record = parseJsonRecord(value, authenticationLimits.serviceProjectionJsonBytes);
  if (typeof record?.revoked !== "boolean") return undefined;
  const projection = record as unknown as ServiceAuthorityProjection;
  const serviceProjection = parseService(
    canonicalService({
      clientId: projection.clientId,
      expiresAtSeconds: projection.expiresAtSeconds,
      issuedAtSeconds: projection.issuedAtSeconds,
      issuer: projection.issuer,
      provider: projection.provider,
      subject: projection.subject,
    }),
  );
  if (!serviceProjection || canonicalServiceAuthority(projection) !== value) return undefined;
  return projection;
}

const lookupFailure = Object.freeze({});
function lookup(authorityLookup: IdentityAuthorityLookup | undefined, key: string): unknown {
  if (!authorityLookup) return lookupFailure;
  try {
    return authorityLookup(key);
  } catch {
    return lookupFailure;
  }
}

export function createAuthenticationService(
  expectedIssuerValue: unknown,
  expectedClientIdValue: unknown,
  clockSkewSecondsValue: unknown,
  identityAuthorityLookupValue?: IdentityAuthorityLookup,
  serviceLookupValue?: IdentityAuthorityLookup,
): AuthenticationService {
  if (
    !isBoundedVisibleAscii(expectedIssuerValue, authenticationLimits.issuerBytes) ||
    !isBoundedVisibleAscii(expectedClientIdValue, authenticationLimits.clientIdBytes) ||
    !isSafeSeconds(clockSkewSecondsValue) ||
    clockSkewSecondsValue > authenticationLimits.clockSkewSeconds ||
    (identityAuthorityLookupValue !== undefined &&
      typeof identityAuthorityLookupValue !== "function") ||
    (serviceLookupValue !== undefined && typeof serviceLookupValue !== "function")
  )
    throw new Error("INVALID_AUTHENTICATION_CONFIGURATION");
  const expectedIssuer = expectedIssuerValue;
  const expectedClientId = expectedClientIdValue;
  const clockSkewSeconds = clockSkewSecondsValue;
  const issuedPrincipals = new WeakSet<object>();
  const issuedMemberships = new WeakMap<object, ResolvedMembership>();
  const issuedServices = new WeakSet<object>();

  function resolveMembership(
    principal: unknown,
    tenantHint: unknown,
    expectedMembershipEpoch: unknown,
    serverNowEpochSeconds: unknown,
  ): MembershipResult {
    if (principal === null || typeof principal !== "object" || !issuedPrincipals.has(principal))
      return authorityDenial("FORGED_IDENTITY");
    if (
      (tenantHint !== undefined &&
        !isBoundedVisibleAscii(tenantHint, authenticationLimits.tenantIdBytes)) ||
      (expectedMembershipEpoch !== undefined &&
        (!isSafeSeconds(expectedMembershipEpoch) || expectedMembershipEpoch === 0)) ||
      !isSafeSeconds(serverNowEpochSeconds)
    )
      return authorityDenial("INVALID_REQUEST");
    const authenticatedPrincipal = principal as AuthenticatedPrincipal;
    if (authenticatedPrincipal.session.expiresAtSeconds <= serverNowEpochSeconds)
      return authorityDenial("EXPIRED");
    const found = lookup(
      identityAuthorityLookupValue,
      principalCredentialKey(authenticatedPrincipal),
    );
    if (found === lookupFailure) return authorityDenial("AUTHORITY_UNAVAILABLE");
    if (found === undefined) return authorityDenial("CREDENTIAL_UNKNOWN");
    const snapshot = parseIdentityAuthoritySnapshot(found);
    if (!snapshot) return authorityDenial("MALFORMED_AUTHORITY");
    const credential = snapshot.credential;
    if (
      credential.clientId !== authenticatedPrincipal.identity.clientId ||
      credential.credentialId !== authenticatedPrincipal.session.credentialId ||
      credential.issuer !== authenticatedPrincipal.identity.issuer ||
      credential.provider !== authenticatedPrincipal.identity.provider ||
      credential.subject !== authenticatedPrincipal.identity.subject
    )
      return authorityDenial("MALFORMED_AUTHORITY");
    if (credential.revoked) return authorityDenial("CREDENTIAL_REVOKED");
    if (authenticatedPrincipal.session.issuedAtSeconds < credential.validAfterSeconds)
      return authorityDenial("CREDENTIAL_STALE");
    const identityMatches = snapshot.memberships.filter(
      (membership) =>
        membership.clientId === authenticatedPrincipal.identity.clientId &&
        membership.issuer === authenticatedPrincipal.identity.issuer &&
        membership.provider === authenticatedPrincipal.identity.provider &&
        membership.subject === authenticatedPrincipal.identity.subject,
    );
    if (identityMatches.length !== snapshot.memberships.length)
      return authorityDenial("MALFORMED_AUTHORITY");
    const matching =
      tenantHint === undefined
        ? identityMatches
        : identityMatches.filter((membership) => membership.tenantId === tenantHint);
    if (matching.length === 0)
      return authorityDenial(identityMatches.length === 0 ? "MEMBERSHIP_UNKNOWN" : "HINT_MISMATCH");
    if (matching.length !== 1) return authorityDenial("MEMBERSHIP_AMBIGUOUS");
    const membership = matching.at(0) as MembershipProjection;
    if (membership.revoked) return authorityDenial("MEMBERSHIP_REVOKED");
    if (membership.expiresAtSeconds <= serverNowEpochSeconds) return authorityDenial("EXPIRED");
    if (
      expectedMembershipEpoch !== undefined &&
      membership.membershipEpoch !== expectedMembershipEpoch
    )
      return authorityDenial("MEMBERSHIP_EPOCH_MISMATCH");
    const resolved: ResolvedMembership = Object.freeze({
      assurance: authenticatedPrincipal.session.assurance,
      authorityRevision: snapshot.authorityRevision,
      effectiveExpiresAtSeconds: Math.min(
        authenticatedPrincipal.session.expiresAtSeconds,
        membership.expiresAtSeconds,
      ),
      membershipEpoch: membership.membershipEpoch,
      membershipId: membership.membershipId,
      principal: authenticatedPrincipal,
      roles: Object.freeze(membership.roles.map((role) => role)),
      tenantId: membership.tenantId,
    });
    issuedMemberships.set(resolved, resolved);
    return Object.freeze({ membership: resolved, outcome: "resolved" });
  }

  function currentService(
    service: AuthenticatedServiceIdentity,
    serverNowEpochSeconds: number,
  ): ServiceIdentityResult {
    const result = lookup(serviceLookupValue, credentialIdentityKey(service.identity));
    if (result === lookupFailure) return authorityDenial("AUTHORITY_UNAVAILABLE");
    if (result === undefined) return authorityDenial("FORGED_IDENTITY");
    const authority = parseServiceAuthority(result);
    if (!authority) return authorityDenial("MALFORMED_AUTHORITY");
    if (
      authority.clientId !== service.identity.clientId ||
      authority.issuer !== service.identity.issuer ||
      authority.provider !== service.identity.provider ||
      authority.subject !== service.identity.subject ||
      authority.expiresAtSeconds !== service.session.expiresAtSeconds ||
      authority.issuedAtSeconds !== service.session.issuedAtSeconds
    )
      return authorityDenial("FORGED_IDENTITY");
    if (authority.revoked) return authorityDenial("SERVICE_REVOKED");
    if (authority.expiresAtSeconds <= serverNowEpochSeconds) return authorityDenial("EXPIRED");
    return Object.freeze({ outcome: "verified", service });
  }

  return Object.freeze({
    authenticate(
      verifiedProjection: unknown,
      serverNowEpochSeconds: unknown,
    ): AuthenticationResult {
      if (
        !isSafeSeconds(serverNowEpochSeconds) ||
        serverNowEpochSeconds > Number.MAX_SAFE_INTEGER - clockSkewSeconds
      )
        return denial("INVALID_SERVER_CONFIGURATION");
      if (verifiedProjection === undefined) return denial("VERIFICATION_FAILED");
      const projection = parseProjection(verifiedProjection);
      if (!projection) return denial("MALFORMED_PROJECTION");
      if (projection.provider !== cognitoIdentityProvider) return denial("MALFORMED_PROJECTION");
      if (projection.issuer !== expectedIssuer) return denial("ISSUER_MISMATCH");
      if (projection.clientId !== expectedClientId) return denial("CLIENT_ID_MISMATCH");
      if (projection.tokenUse !== "access") return denial("TOKEN_USE_MISMATCH");
      if (
        projection.authenticatedAtSeconds > projection.issuedAtSeconds ||
        projection.issuedAtSeconds >= projection.expiresAtSeconds
      )
        return denial("MALFORMED_PROJECTION");
      const latestAcceptedStart = serverNowEpochSeconds + clockSkewSeconds;
      if (
        projection.issuedAtSeconds > latestAcceptedStart ||
        projection.authenticatedAtSeconds > latestAcceptedStart
      )
        return denial("NOT_YET_ACTIVE");
      const earliestAcceptedExpiry = serverNowEpochSeconds - clockSkewSeconds;
      if (projection.expiresAtSeconds <= earliestAcceptedExpiry) return denial("EXPIRED");
      const result = verifiedPrincipal(projection);
      issuedPrincipals.add(result.principal);
      return result;
    },
    authenticateService(
      verifiedProjection: unknown,
      serverNowEpochSeconds: unknown,
    ): ServiceIdentityResult {
      if (!isSafeSeconds(serverNowEpochSeconds)) return authorityDenial("INVALID_REQUEST");
      const projection = parseService(verifiedProjection);
      if (!projection || projection.provider !== serviceIdentityProvider)
        return authorityDenial("INVALID_REQUEST");
      if (
        projection.issuedAtSeconds >= projection.expiresAtSeconds ||
        projection.issuedAtSeconds > serverNowEpochSeconds ||
        projection.expiresAtSeconds <= serverNowEpochSeconds
      )
        return authorityDenial("EXPIRED");
      const identity = Object.freeze({
        clientId: projection.clientId,
        issuer: projection.issuer,
        provider: serviceIdentityProvider,
        subject: projection.subject,
      });
      const service: AuthenticatedServiceIdentity = Object.freeze({
        identity,
        kind: "service",
        session: Object.freeze({
          expiresAtSeconds: projection.expiresAtSeconds,
          issuedAtSeconds: projection.issuedAtSeconds,
        }),
      });
      const current = currentService(service, serverNowEpochSeconds);
      if (current.outcome === "denied") return current;
      issuedServices.add(service);
      return Object.freeze({ outcome: "verified", service });
    },
    resolveMembership,
    validateMembership(membership: unknown, serverNowEpochSeconds: unknown): MembershipResult {
      if (
        membership === null ||
        typeof membership !== "object" ||
        !issuedMemberships.has(membership)
      )
        return authorityDenial("FORGED_IDENTITY");
      if (!isSafeSeconds(serverNowEpochSeconds)) return authorityDenial("INVALID_REQUEST");
      const issued = issuedMemberships.get(membership) as ResolvedMembership;
      const current = resolveMembership(
        issued.principal,
        issued.tenantId,
        issued.membershipEpoch,
        serverNowEpochSeconds,
      );
      if (current.outcome === "denied") return current;
      const candidate = current.membership;
      if (
        candidate.principal !== issued.principal ||
        candidate.assurance !== issued.assurance ||
        candidate.authorityRevision !== issued.authorityRevision ||
        candidate.effectiveExpiresAtSeconds !== issued.effectiveExpiresAtSeconds ||
        candidate.membershipEpoch !== issued.membershipEpoch ||
        candidate.membershipId !== issued.membershipId ||
        candidate.tenantId !== issued.tenantId ||
        candidate.roles.length !== issued.roles.length ||
        candidate.roles.some((role, index) => role !== issued.roles.at(index))
      )
        return authorityDenial("MEMBERSHIP_EPOCH_MISMATCH");
      return Object.freeze({ membership: issued, outcome: "resolved" });
    },
    validateService(service: unknown, serverNowEpochSeconds: unknown): ServiceIdentityResult {
      if (service === null || typeof service !== "object" || !issuedServices.has(service))
        return authorityDenial("FORGED_IDENTITY");
      if (!isSafeSeconds(serverNowEpochSeconds)) return authorityDenial("INVALID_REQUEST");
      return currentService(service as AuthenticatedServiceIdentity, serverNowEpochSeconds);
    },
  });
}
