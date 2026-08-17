declare module "node:util" {
  export const types: {
    readonly isProxy: (value: unknown) => unknown;
  };
}
