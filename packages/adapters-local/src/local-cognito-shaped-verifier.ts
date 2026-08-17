import {
  isOwnedJsonArray,
  isOwnedJsonObject,
  type OwnedJson,
  type OwnedJsonObject,
  ownedJsonAt,
  ownedJsonEntries,
  ownedJsonLength,
  parseOwnedJson,
  readOwnedJson,
} from "@zintus-continuity/foundation/owned-json";
import {
  advanceLocalTenantAuthorityGeneration,
  createLocalTenantAuthorityCoordinator,
  type LocalTenantAuthorityCoordinator,
  readLocalTenantAuthorityGeneration,
} from "./local-tenant-authority-fixture.js";

export const localCognitoSyntheticLimits = Object.freeze({
  arrayLength: 16,
  authorityFixtureJsonBytes: 32_768,
  authorityNodes: 512,
  credentialCount: 8,
  credentialRefBytes: 128,
  fixtureJsonBytes: 16_384,
  nestingDepth: 7,
  objectProperties: 16,
  rawClaimsBytes: 2048,
  rawClaimsDepth: 4,
  rawClaimsNodes: 128,
  stringBytes: 256,
  totalNodes: 168,
});
interface InspectionBudget {
  nodes: number;
}

export type LocalCognitoShapedSyntheticVerifier = (credential: string) => string | undefined;

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

function compareCanonicalKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function inspectJson(
  value: OwnedJson,
  depth: number,
  maximumDepth: number,
  budget: InspectionBudget,
  maximumNodes: number,
): boolean {
  budget.nodes += 1;
  if (budget.nodes > maximumNodes || depth > maximumDepth) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string")
    return utf8BytesWithin(value, localCognitoSyntheticLimits.stringBytes) !== undefined;
  if (isOwnedJsonArray(value)) {
    const length = ownedJsonLength(value);
    if (length > localCognitoSyntheticLimits.arrayLength) return false;
    for (let index = 0; index < length; index += 1) {
      const entry = ownedJsonAt(value, index);
      if (entry === undefined || !inspectJson(entry, depth + 1, maximumDepth, budget, maximumNodes))
        return false;
    }
    return true;
  }
  if (!isOwnedJsonObject(value)) return false;
  const entries = ownedJsonEntries(value);
  if (entries.length > localCognitoSyntheticLimits.objectProperties) return false;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries.at(index);
    if (
      !entry ||
      utf8BytesWithin(entry.at(0) as string, localCognitoSyntheticLimits.stringBytes) ===
        undefined ||
      !inspectJson(entry.at(1) as OwnedJson, depth + 1, maximumDepth, budget, maximumNodes)
    )
      return false;
  }
  return true;
}

function canonicalJson(value: OwnedJson): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (isOwnedJsonArray(value)) {
    let output = "[";
    for (let index = 0; index < ownedJsonLength(value); index += 1) {
      if (index > 0) output += ",";
      const child = ownedJsonAt(value, index);
      if (child === undefined) invalidFixture();
      output += canonicalJson(child);
    }
    return `${output}]`;
  }
  if (!isOwnedJsonObject(value)) invalidFixture();
  const entries = ownedJsonEntries(value)
    .slice()
    .sort((left, right) => compareCanonicalKeys(left.at(0) as string, right.at(0) as string));
  let output = "{";
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries.at(index);
    if (!entry) invalidFixture();
    if (index > 0) output += ",";
    output += `${JSON.stringify(entry.at(0))}:${canonicalJson(entry.at(1) as OwnedJson)}`;
  }
  return `${output}}`;
}

function exactObjectKeys(value: OwnedJson, keys: readonly string[]): value is OwnedJsonObject {
  if (!isOwnedJsonObject(value)) return false;
  const entries = ownedJsonEntries(value);
  return (
    entries.length === keys.length && entries.every((entry) => keys.includes(entry.at(0) as string))
  );
}

function visibleAscii(value: OwnedJson | undefined, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    /^[\x21-\x7e]+$/u.test(value)
  );
}

function normalizedAuthenticationMethods(value: OwnedJson | undefined): readonly string[] | null {
  if (!isOwnedJsonArray(value)) return null;
  const methods: string[] = [];
  for (let index = 0; index < ownedJsonLength(value); index += 1) {
    const method = ownedJsonAt(value, index);
    if ((method !== "mfa" && method !== "pwd") || methods.includes(method)) return null;
    methods.push(method);
  }
  methods.sort(compareCanonicalKeys);
  return methods.length > 0 ? methods : null;
}

function canonicalProjection(claims: OwnedJsonObject): string {
  const projection = {
    authenticationMethods: normalizedAuthenticationMethods(readOwnedJson(claims, "amr")),
    authenticatedAtSeconds: readOwnedJson(claims, "auth_time"),
    clientId: readOwnedJson(claims, "client_id"),
    credentialId: readOwnedJson(claims, "jti"),
    expiresAtSeconds: readOwnedJson(claims, "exp"),
    issuedAtSeconds: readOwnedJson(claims, "iat"),
    issuer: readOwnedJson(claims, "iss"),
    provider: "cognito",
    subject: readOwnedJson(claims, "sub"),
    tokenUse: readOwnedJson(claims, "token_use"),
  };
  return JSON.stringify(projection);
}

function invalidFixture(): never {
  throw new Error("INVALID_LOCAL_COGNITO_SHAPED_SYNTHETIC_FIXTURE");
}

export function createLocalCognitoShapedSyntheticVerifier(
  fixtureJsonValue: unknown,
): LocalCognitoShapedSyntheticVerifier {
  if (typeof fixtureJsonValue !== "string") invalidFixture();
  const byteLength = utf8BytesWithin(
    fixtureJsonValue,
    localCognitoSyntheticLimits.fixtureJsonBytes,
  );
  if (byteLength === undefined || byteLength === 0) invalidFixture();
  let parsed: OwnedJson;
  try {
    parsed = parseOwnedJson(fixtureJsonValue, "small");
  } catch {
    invalidFixture();
  }
  const totalBudget = { nodes: 0 };
  if (
    !inspectJson(
      parsed,
      0,
      localCognitoSyntheticLimits.nestingDepth,
      totalBudget,
      localCognitoSyntheticLimits.totalNodes,
    ) ||
    !exactObjectKeys(parsed, ["fixtures"])
  )
    invalidFixture();
  const fixtureValues = readOwnedJson(parsed, "fixtures");
  if (
    !isOwnedJsonArray(fixtureValues) ||
    ownedJsonLength(fixtureValues) === 0 ||
    ownedJsonLength(fixtureValues) > localCognitoSyntheticLimits.credentialCount
  )
    invalidFixture();
  const fixtures = new Map<string, string>();
  for (let index = 0; index < ownedJsonLength(fixtureValues); index += 1) {
    const fixture = ownedJsonAt(fixtureValues, index);
    const rawClaims = isOwnedJsonObject(fixture) ? readOwnedJson(fixture, "rawClaims") : undefined;
    if (
      fixture === undefined ||
      !exactObjectKeys(fixture, ["credentialRef", "rawClaims"]) ||
      !isOwnedJsonObject(fixture) ||
      !visibleAscii(
        readOwnedJson(fixture, "credentialRef"),
        localCognitoSyntheticLimits.credentialRefBytes,
      ) ||
      !isOwnedJsonObject(rawClaims)
    )
      invalidFixture();
    const credentialRef = readOwnedJson(fixture, "credentialRef") as string;
    const rawBudget = { nodes: 0 };
    if (
      !inspectJson(
        rawClaims,
        0,
        localCognitoSyntheticLimits.rawClaimsDepth,
        rawBudget,
        localCognitoSyntheticLimits.rawClaimsNodes,
      )
    )
      invalidFixture();
    const rawCanonical = canonicalJson(rawClaims);
    if (
      utf8BytesWithin(rawCanonical, localCognitoSyntheticLimits.rawClaimsBytes) === undefined ||
      fixtures.has(credentialRef)
    )
      invalidFixture();
    fixtures.set(credentialRef, canonicalProjection(rawClaims));
  }
  return (credential: string): string | undefined => fixtures.get(credential);
}

interface LocalCredentialRecord {
  readonly clientId: string;
  readonly credentialId: string;
  readonly issuer: string;
  readonly provider: "cognito";
  revoked: boolean;
  readonly subject: string;
  validAfterSeconds: number;
}

interface LocalMembershipRecord {
  readonly clientId: string;
  readonly expiresAtSeconds: number;
  readonly issuer: string;
  membershipEpoch: number;
  readonly membershipId: string;
  readonly provider: "cognito";
  revoked: boolean;
  readonly roles: readonly string[];
  readonly subject: string;
  readonly tenantId: string;
}

interface LocalServiceRecord {
  readonly clientId: string;
  readonly credentialRef: string;
  readonly expiresAtSeconds: number;
  readonly issuedAtSeconds: number;
  readonly issuer: string;
  readonly provider: "service";
  revoked: boolean;
  readonly subject: string;
}

export interface LocalIdentityAuthorityFixture {
  readonly lookupIdentityAuthority: (principalCredentialKey: string) => string | undefined;
  readonly lookupService: (credentialIdentityKey: string) => string | undefined;
  readonly readAuthorityGeneration: () => object;
  readonly reactivateCredential: (credentialId: unknown, validAfterSeconds: unknown) => void;
  readonly revokeCredential: (credentialId: unknown) => void;
  readonly revokeMembership: (membershipId: unknown) => void;
  readonly revokeService: (credentialRef: unknown) => void;
  readonly setMembershipEpoch: (membershipId: unknown, epoch: unknown) => void;
  readonly verifyServiceCredential: (credentialRef: unknown) => string | undefined;
}

function identityKey(value: {
  readonly clientId: string;
  readonly issuer: string;
  readonly provider: string;
  readonly subject: string;
}): string {
  return JSON.stringify({
    clientId: value.clientId,
    issuer: value.issuer,
    provider: value.provider,
    subject: value.subject,
  });
}

function credentialAuthorityKey(value: LocalCredentialRecord): string {
  return JSON.stringify({
    clientId: value.clientId,
    credentialId: value.credentialId,
    issuer: value.issuer,
    provider: value.provider,
    subject: value.subject,
  });
}

function safeSeconds(value: OwnedJson | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function hasDuplicate(values: readonly string[]): boolean {
  const seen = new Set<string>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values.at(index) as string;
    if (seen.has(value)) return true;
    seen.add(value);
  }
  return false;
}

function requiredArray(value: OwnedJson | undefined, maximum: number): OwnedJson[] {
  if (!isOwnedJsonArray(value) || ownedJsonLength(value) > maximum) invalidAuthorityFixture();
  const result: OwnedJson[] = [];
  for (let index = 0; index < ownedJsonLength(value); index += 1) {
    const item = ownedJsonAt(value, index);
    if (item === undefined) invalidAuthorityFixture();
    result.push(item);
  }
  return result;
}

function invalidAuthorityFixture(): never {
  throw new Error("INVALID_LOCAL_IDENTITY_AUTHORITY_FIXTURE");
}

function invalidAuthorityOperation(): never {
  throw new Error("INVALID_LOCAL_IDENTITY_AUTHORITY_OPERATION");
}

function membershipJson(value: LocalMembershipRecord): string {
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

function credentialAuthorityJson(value: LocalCredentialRecord): string {
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

function serviceProjectionJson(value: LocalServiceRecord): string {
  return JSON.stringify({
    clientId: value.clientId,
    expiresAtSeconds: value.expiresAtSeconds,
    issuedAtSeconds: value.issuedAtSeconds,
    issuer: value.issuer,
    provider: value.provider,
    subject: value.subject,
  });
}

function serviceAuthorityJson(value: LocalServiceRecord): string {
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

export function createLocalIdentityAuthorityFixture(
  fixtureJsonValue: unknown,
  coordinatorValue?: LocalTenantAuthorityCoordinator,
): LocalIdentityAuthorityFixture {
  const coordinator = coordinatorValue ?? createLocalTenantAuthorityCoordinator();
  readLocalTenantAuthorityGeneration(coordinator);
  if (typeof fixtureJsonValue !== "string") invalidAuthorityFixture();
  const byteLength = utf8BytesWithin(
    fixtureJsonValue,
    localCognitoSyntheticLimits.authorityFixtureJsonBytes,
  );
  if (byteLength === undefined || byteLength === 0) invalidAuthorityFixture();
  let parsed: OwnedJson;
  try {
    parsed = parseOwnedJson(fixtureJsonValue, "small");
  } catch {
    invalidAuthorityFixture();
  }
  const budget = { nodes: 0 };
  if (
    !inspectJson(
      parsed,
      0,
      localCognitoSyntheticLimits.nestingDepth,
      budget,
      localCognitoSyntheticLimits.authorityNodes,
    ) ||
    !exactObjectKeys(parsed, ["credentials", "memberships", "services"])
  )
    invalidAuthorityFixture();
  const credentials = requiredArray(
    readOwnedJson(parsed, "credentials"),
    localCognitoSyntheticLimits.credentialCount,
  ).map((value): LocalCredentialRecord => {
    if (
      !exactObjectKeys(value, [
        "clientId",
        "credentialId",
        "issuer",
        "provider",
        "revoked",
        "subject",
        "validAfterSeconds",
      ])
    )
      invalidAuthorityFixture();
    const clientId = readOwnedJson(value, "clientId");
    const credentialId = readOwnedJson(value, "credentialId");
    const issuer = readOwnedJson(value, "issuer");
    const provider = readOwnedJson(value, "provider");
    const revoked = readOwnedJson(value, "revoked");
    const subject = readOwnedJson(value, "subject");
    const validAfterSeconds = readOwnedJson(value, "validAfterSeconds");
    if (
      !visibleAscii(clientId, 128) ||
      !visibleAscii(credentialId, 256) ||
      !visibleAscii(issuer, 512) ||
      provider !== "cognito" ||
      typeof revoked !== "boolean" ||
      !visibleAscii(subject, 256) ||
      !safeSeconds(validAfterSeconds)
    )
      invalidAuthorityFixture();
    return {
      clientId,
      credentialId,
      issuer,
      provider,
      revoked,
      subject,
      validAfterSeconds,
    };
  });
  if (
    hasDuplicate(credentials.map((value) => value.credentialId)) ||
    hasDuplicate(credentials.map(credentialAuthorityKey))
  )
    invalidAuthorityFixture();
  const memberships = requiredArray(
    readOwnedJson(parsed, "memberships"),
    localCognitoSyntheticLimits.credentialCount,
  ).map((value): LocalMembershipRecord => {
    if (
      !exactObjectKeys(value, [
        "clientId",
        "expiresAtSeconds",
        "issuer",
        "membershipEpoch",
        "membershipId",
        "provider",
        "revoked",
        "roles",
        "subject",
        "tenantId",
      ])
    )
      invalidAuthorityFixture();
    const roles = requiredArray(readOwnedJson(value, "roles"), 3);
    const clientId = readOwnedJson(value, "clientId");
    const expiresAtSeconds = readOwnedJson(value, "expiresAtSeconds");
    const issuer = readOwnedJson(value, "issuer");
    const membershipEpoch = readOwnedJson(value, "membershipEpoch");
    const membershipId = readOwnedJson(value, "membershipId");
    const provider = readOwnedJson(value, "provider");
    const revoked = readOwnedJson(value, "revoked");
    const subject = readOwnedJson(value, "subject");
    const tenantId = readOwnedJson(value, "tenantId");
    if (
      !visibleAscii(clientId, 128) ||
      !safeSeconds(expiresAtSeconds) ||
      !visibleAscii(issuer, 512) ||
      !safeSeconds(membershipEpoch) ||
      membershipEpoch === 0 ||
      !visibleAscii(membershipId, 128) ||
      provider !== "cognito" ||
      typeof revoked !== "boolean" ||
      roles.length === 0 ||
      !roles.every((role) => visibleAscii(role, 32)) ||
      !visibleAscii(subject, 256) ||
      !visibleAscii(tenantId, 128)
    )
      invalidAuthorityFixture();
    return {
      clientId,
      expiresAtSeconds,
      issuer,
      membershipEpoch,
      membershipId,
      provider,
      revoked,
      roles: roles as string[],
      subject,
      tenantId,
    };
  });
  if (hasDuplicate(memberships.map((value) => value.membershipId))) invalidAuthorityFixture();
  const services = requiredArray(
    readOwnedJson(parsed, "services"),
    localCognitoSyntheticLimits.credentialCount,
  ).map((value): LocalServiceRecord => {
    if (
      !exactObjectKeys(value, [
        "clientId",
        "credentialRef",
        "expiresAtSeconds",
        "issuedAtSeconds",
        "issuer",
        "provider",
        "revoked",
        "subject",
      ])
    )
      invalidAuthorityFixture();
    const clientId = readOwnedJson(value, "clientId");
    const credentialRef = readOwnedJson(value, "credentialRef");
    const expiresAtSeconds = readOwnedJson(value, "expiresAtSeconds");
    const issuedAtSeconds = readOwnedJson(value, "issuedAtSeconds");
    const issuer = readOwnedJson(value, "issuer");
    const provider = readOwnedJson(value, "provider");
    const revoked = readOwnedJson(value, "revoked");
    const subject = readOwnedJson(value, "subject");
    if (
      !visibleAscii(clientId, 128) ||
      !visibleAscii(credentialRef, localCognitoSyntheticLimits.credentialRefBytes) ||
      !safeSeconds(expiresAtSeconds) ||
      !safeSeconds(issuedAtSeconds) ||
      issuedAtSeconds >= expiresAtSeconds ||
      !visibleAscii(issuer, 512) ||
      provider !== "service" ||
      typeof revoked !== "boolean" ||
      !visibleAscii(subject, 256)
    )
      invalidAuthorityFixture();
    return {
      clientId,
      credentialRef,
      expiresAtSeconds,
      issuedAtSeconds,
      issuer,
      provider,
      revoked,
      subject,
    };
  });
  if (
    hasDuplicate(services.map((value) => value.credentialRef)) ||
    hasDuplicate(services.map(identityKey))
  )
    invalidAuthorityFixture();
  let authorityRevision = 1;
  const advanceAuthorityRevision = () => {
    if (authorityRevision === Number.MAX_SAFE_INTEGER) invalidAuthorityOperation();
    authorityRevision += 1;
  };

  return Object.freeze({
    lookupIdentityAuthority: (key: string) => {
      if (typeof key !== "string") return undefined;
      const credential = credentials.find((value) => credentialAuthorityKey(value) === key);
      if (!credential) return undefined;
      const matching = memberships.filter(
        (value) => identityKey(value) === identityKey(credential),
      );
      return `{"authorityRevision":${String(authorityRevision)},"credential":${credentialAuthorityJson(credential)},"memberships":[${matching.map(membershipJson).join(",")}]}`;
    },
    lookupService: (key: string) => {
      if (typeof key !== "string") return undefined;
      const service = services.find((value) => identityKey(value) === key);
      return service ? serviceAuthorityJson(service) : undefined;
    },
    readAuthorityGeneration: () => readLocalTenantAuthorityGeneration(coordinator),
    reactivateCredential: (credentialId: unknown, validAfterSeconds: unknown) => {
      if (
        typeof credentialId !== "string" ||
        typeof validAfterSeconds !== "number" ||
        !Number.isSafeInteger(validAfterSeconds) ||
        validAfterSeconds < 0
      )
        invalidAuthorityOperation();
      const credential = credentials.find((value) => value.credentialId === credentialId);
      if (!credential) invalidAuthorityOperation();
      credential.revoked = false;
      credential.validAfterSeconds = validAfterSeconds;
      advanceAuthorityRevision();
      advanceLocalTenantAuthorityGeneration(coordinator);
    },
    revokeCredential: (credentialId: unknown) => {
      if (typeof credentialId !== "string") invalidAuthorityOperation();
      const credential = credentials.find((value) => value.credentialId === credentialId);
      if (!credential) invalidAuthorityOperation();
      credential.revoked = true;
      advanceAuthorityRevision();
      advanceLocalTenantAuthorityGeneration(coordinator);
    },
    revokeMembership: (membershipId: unknown) => {
      if (typeof membershipId !== "string") invalidAuthorityOperation();
      const membership = memberships.find((value) => value.membershipId === membershipId);
      if (!membership) invalidAuthorityOperation();
      membership.revoked = true;
      advanceAuthorityRevision();
      advanceLocalTenantAuthorityGeneration(coordinator);
    },
    revokeService: (credentialRef: unknown) => {
      if (typeof credentialRef !== "string") invalidAuthorityOperation();
      const service = services.find((value) => value.credentialRef === credentialRef);
      if (!service) invalidAuthorityOperation();
      service.revoked = true;
      advanceLocalTenantAuthorityGeneration(coordinator);
    },
    setMembershipEpoch: (membershipId: unknown, epoch: unknown) => {
      if (
        typeof membershipId !== "string" ||
        typeof epoch !== "number" ||
        !Number.isSafeInteger(epoch) ||
        epoch <= 0
      )
        invalidAuthorityOperation();
      const membership = memberships.find((value) => value.membershipId === membershipId);
      if (!membership) invalidAuthorityOperation();
      membership.membershipEpoch = epoch;
      advanceAuthorityRevision();
      advanceLocalTenantAuthorityGeneration(coordinator);
    },
    verifyServiceCredential: (credentialRef: unknown) => {
      if (typeof credentialRef !== "string") return undefined;
      const service = services.find((value) => value.credentialRef === credentialRef);
      return service ? serviceProjectionJson(service) : undefined;
    },
  });
}
