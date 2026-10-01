import { describe, expect, it } from "vite-plus/test";

import { formatCompactDiffCount } from "./DiffStatLabel";

describe("formatCompactDiffCount", () => {
  it("compacts diff counts with one decimal under 10 units", () => {
    expect(formatCompactDiffCount(0)).toBe("0");
    expect(formatCompactDiffCount(999)).toBe("999");
    expect(formatCompactDiffCount(1400)).toBe("1.4k");
    expect(formatCompactDiffCount(14_000)).toBe("14k");
    expect(formatCompactDiffCount(1_500_000)).toBe("1.5m");
    expect(formatCompactDiffCount(1_500_000_000)).toBe("1.5b");
  });

  it("promotes a rounded-up boundary into the next unit instead of printing 1000k", () => {
    expect(formatCompactDiffCount(999_499)).toBe("999k");
    expect(formatCompactDiffCount(999_500)).toBe("1m");
    expect(formatCompactDiffCount(999_999)).toBe("1m");
    expect(formatCompactDiffCount(999_999_499)).toBe("1b");
    expect(formatCompactDiffCount(999_999_500)).toBe("1b");
  });
});
