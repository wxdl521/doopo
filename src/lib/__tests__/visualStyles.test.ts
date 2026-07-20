import { describe, expect, it } from "vitest";
import { resolveI2IModel } from "../visualStyles";

describe("resolveI2IModel", () => {
  it("does not route OneToken text-to-image models into reference-image flows", () => {
    expect(resolveI2IModel("onetoken/gpt-image-2")).toBe("doubao-seedream-5-0-260128");
  });

  it("keeps the configured Seedream I2I model", () => {
    expect(resolveI2IModel("doubao-seedream-5-0-260128")).toBe(
      "doubao-seedream-5-0-260128",
    );
  });
});
