declare module "node:crypto" {
  export function createHash(algorithm: "sha256"): {
    update(value: string, encoding: "utf8"): { digest(encoding: "hex"): string };
  };
}
