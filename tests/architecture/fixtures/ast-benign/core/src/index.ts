// process["env"], require("fs"), and globalThis.fetch are inert comment text.
export const explanation = "fetch and process.getBuiltinModule are ordinary string content";

interface Labels {
  constructor: string;
  eval: string;
}

export const labels: Labels = {
  constructor: "metadata",
  eval: "description",
};
