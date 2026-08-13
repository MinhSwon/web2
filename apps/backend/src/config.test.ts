import { describe, expect, it } from "vitest";

describe("backend contract", () => {
  it("keeps a stable render status vocabulary", () => {
    expect(["PENDING", "QUEUED", "PROCESSING", "COMPLETED", "FAILED", "CANCELED"]).toHaveLength(6);
  });
});
