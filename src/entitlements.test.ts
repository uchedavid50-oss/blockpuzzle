import { describe, expect, it } from "vitest";
import {
  ALL_SKUS,
  CATALOGUE,
  NOTHING,
  formatPrice,
  forSale,
  grant,
  isAdFree,
  isSku,
  item,
  owns,
  parse,
} from "./entitlements.js";

describe("owns", () => {
  it("is false for everything when nothing is owned", () => {
    for (const sku of ALL_SKUS) expect(owns(NOTHING, sku)).toBe(false);
  });

  it("is true for a directly granted sku", () => {
    expect(owns(grant(NOTHING, "effect_pack"), "effect_pack")).toBe(true);
  });

  it("treats the bundle as owning its contents", () => {
    const e = grant(NOTHING, "supporter_bundle");
    expect(owns(e, "no_interstitials")).toBe(true);
    expect(owns(e, "theme_pack_dusk")).toBe(true);
    expect(owns(e, "theme_pack_citrus")).toBe(true);
    expect(owns(e, "effect_pack")).toBe(true);
  });

  it("does not grant the bundle from owning its contents", () => {
    let e = NOTHING;
    for (const sku of ["no_interstitials", "theme_pack_dusk", "theme_pack_citrus", "effect_pack"] as const) {
      e = grant(e, sku);
    }
    expect(owns(e, "supporter_bundle")).toBe(false);
  });
});

describe("grant", () => {
  it("is idempotent, so a replayed webhook cannot double-grant", () => {
    const once = grant(NOTHING, "effect_pack");
    const twice = grant(once, "effect_pack");
    expect(twice.owned).toEqual(["effect_pack"]);
    expect(twice).toBe(once);
  });

  it("does not mutate the input", () => {
    const before = grant(NOTHING, "effect_pack");
    grant(before, "theme_pack_dusk");
    expect(before.owned).toEqual(["effect_pack"]);
  });
});

describe("isAdFree", () => {
  it("is false by default", () => {
    expect(isAdFree(NOTHING)).toBe(false);
  });

  it("is true from the direct purchase and from the bundle", () => {
    expect(isAdFree(grant(NOTHING, "no_interstitials"))).toBe(true);
    expect(isAdFree(grant(NOTHING, "supporter_bundle"))).toBe(true);
  });

  it("is not granted by a cosmetic purchase", () => {
    expect(isAdFree(grant(NOTHING, "theme_pack_dusk"))).toBe(false);
  });
});

describe("parse", () => {
  it("returns nothing for junk", () => {
    for (const junk of [null, undefined, 0, "", "owned", [], { owned: "all" }]) {
      expect(parse(junk).owned).toEqual([]);
    }
  });

  it("drops skus it does not recognise", () => {
    expect(parse({ owned: ["effect_pack", "free_everything", 7] }).owned).toEqual(["effect_pack"]);
  });

  it("de-duplicates", () => {
    expect(parse({ owned: ["effect_pack", "effect_pack"] }).owned).toEqual(["effect_pack"]);
  });

  it("round-trips a granted record", () => {
    const e = grant(grant(NOTHING, "effect_pack"), "theme_pack_dusk");
    expect(parse(JSON.parse(JSON.stringify(e)))).toEqual(e);
  });
});

describe("catalogue", () => {
  it("has an entry for every sku, and no extras", () => {
    expect(CATALOGUE.map((i) => i.sku).sort()).toEqual([...ALL_SKUS].sort());
  });

  it("prices every item above zero in both currencies", () => {
    for (const i of CATALOGUE) {
      expect(i.price.ngn).toBeGreaterThan(0);
      expect(i.price.usd).toBeGreaterThan(0);
    }
  });

  it("prices the bundle below the sum of its parts", () => {
    const parts = CATALOGUE.filter((i) => i.sku !== "supporter_bundle");
    const bundle = item("supporter_bundle")!;
    expect(bundle.price.usd).toBeLessThan(parts.reduce((n, i) => n + i.price.usd, 0));
    expect(bundle.price.ngn).toBeLessThan(parts.reduce((n, i) => n + i.price.ngn, 0));
  });

  it("hides what the player already owns", () => {
    const e = grant(NOTHING, "effect_pack");
    expect(forSale(e).map((i) => i.sku)).not.toContain("effect_pack");
  });

  it("shows an empty shop to a bundle owner", () => {
    expect(forSale(grant(NOTHING, "supporter_bundle"))).toHaveLength(0);
  });
});

describe("isSku", () => {
  it("rejects anything not in the catalogue", () => {
    expect(isSku("no_interstitials")).toBe(true);
    expect(isSku("free_everything")).toBe(false);
  });
});

describe("formatPrice", () => {
  it("renders minor units as major", () => {
    expect(formatPrice({ ngn: 150_000, usd: 299 }, "USD")).toBe("$2.99");
    expect(formatPrice({ ngn: 150_000, usd: 299 }, "NGN")).toBe("₦1,500");
  });
});
