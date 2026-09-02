import { describe, expect, it } from "vitest";

import { normalizePatternArms } from "./control-boundaries";

describe("visible control boundaries", () => {
  it("clamps a retained structure count when entering the vortex field", () => {
    expect(normalizePatternArms("vortex", 12)).toBe(8);
    expect(normalizePatternArms("vortex", 1)).toBe(1);
  });

  it.each(["interference", "liquid", "fracture"] as const)(
    "clamps a retained vortex count when entering the %s field",
    (kind) => {
      expect(normalizePatternArms(kind, 1)).toBe(3);
      expect(normalizePatternArms(kind, 12)).toBe(12);
    },
  );

  it("does not rewrite arms for fields that do not expose that control", () => {
    expect(normalizePatternArms("flat", 12)).toBe(12);
    expect(normalizePatternArms("wave", 1)).toBe(1);
    expect(normalizePatternArms("noise", 12)).toBe(12);
  });
});
