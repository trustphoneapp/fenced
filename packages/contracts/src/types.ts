import type { contractSchemaCatalog } from "./generated/schema-catalog.js";

type Catalog = typeof contractSchemaCatalog;
type EnvelopeDefinitions = Catalog["envelope.schema.json"]["$defs"];

declare const contractBrand: unique symbol;

export type OpaqueId<Field extends string> = string & {
  readonly [contractBrand]: `id:${Field}`;
};
export type OpaqueReference<Field extends string> = string & {
  readonly [contractBrand]: `ref:${Field}`;
};
export type CanonicalUint64 = string & { readonly [contractBrand]: "uint64" };
export type CanonicalInt64 = string & { readonly [contractBrand]: "int64" };
export type Sha256Hex = string & { readonly [contractBrand]: "sha256" };

type DefinitionName<Reference extends string> =
  Reference extends `./envelope.schema.json#/$defs/${infer Name}` ? Name : never;

type ReferencedType<Reference extends string, Field extends string> =
  DefinitionName<Reference> extends infer Name extends string
    ? Name extends "identifier"
      ? OpaqueId<Field>
      : Name extends "reference"
        ? OpaqueReference<Field>
        : Name extends "uint64" | "positiveUint64"
          ? CanonicalUint64
          : Name extends "int64"
            ? CanonicalInt64
            : Name extends "sha256"
              ? Sha256Hex
              : Name extends keyof EnvelopeDefinitions
                ? InferSchema<EnvelopeDefinitions[Name], Field>
                : string
    : string;

type RequiredKeys<Schema> = Schema extends {
  readonly required: readonly (infer Key extends string)[];
}
  ? Key
  : never;

type ObjectType<Properties extends Readonly<Record<string, unknown>>, Schema> = Readonly<
  {
    [Key in keyof Properties as Key extends RequiredKeys<Schema> ? Key : never]-?: InferSchema<
      Properties[Key],
      Extract<Key, string>
    >;
  } & {
    [Key in keyof Properties as Key extends RequiredKeys<Schema> ? never : Key]?: InferSchema<
      Properties[Key],
      Extract<Key, string>
    >;
  }
>;

export type InferSchema<Schema, Field extends string = "value"> = Schema extends {
  readonly $ref: infer Reference extends string;
}
  ? ReferencedType<Reference, Field>
  : Schema extends { readonly const: infer Constant }
    ? Constant
    : Schema extends { readonly enum: readonly (infer Entry)[] }
      ? Entry
      : Schema extends { readonly oneOf: readonly (infer Branch)[] }
        ? InferSchema<Branch, Field>
        : Schema extends { readonly anyOf: readonly (infer Branch)[] }
          ? InferSchema<Branch, Field>
          : Schema extends {
                readonly type: "object";
                readonly properties: infer Properties extends Readonly<Record<string, unknown>>;
              }
            ? ObjectType<Properties, Schema>
            : Schema extends { readonly type: "array"; readonly items: infer Item }
              ? readonly InferSchema<Item, Field>[]
              : string;

export type ApiContractV1 = InferSchema<Catalog["api.schema.json"]>;
export type EventContractV1 = InferSchema<Catalog["event.schema.json"]>;
export type PolicyContractV1 = InferSchema<Catalog["policy.schema.json"]>;
export type ProviderContractV1 = InferSchema<Catalog["provider.schema.json"]>;
export type ReceiptContractV1 = InferSchema<Catalog["receipt.schema.json"]>;
export type RegistryContractV1 = InferSchema<Catalog["registry.schema.json"]>;
export type TaskContractV1 = InferSchema<Catalog["task.schema.json"]>;
