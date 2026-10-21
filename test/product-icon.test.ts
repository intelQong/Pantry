import { describe, it, expect } from "vitest";
import { productIcon } from "../src/client/lib/productIcon";
import { CATALOG } from "../src/client/lib/catalog";
import { PRODUCT_ICON_PATHS } from "../src/client/lib/productIconPaths";

describe("productIcon", () => {
  it("matches by keyword, whatever the casing or the bracketed extra", () => {
    expect(productIcon("Rice")).toBe("cooked-rice");
    expect(productIcon("basmati rice")).toBe("cooked-rice");
    expect(productIcon("Masoor Dal (Red Lentils)")).toBe("beans");
    expect(productIcon("Mugh Daal")).toBe("beans");
    expect(productIcon("Atta (Wheat Flour)")).toBe("sheaf-of-rice");
  });

  it("lets the specific rule win over the general one it overlaps", () => {
    expect(productIcon("Ice Cream")).toBe("ice-cream");
    expect(productIcon("Sweet Potato")).toBe("roasted-sweet-potato");
    expect(productIcon("Pineapple")).toBe("pineapple");
    expect(productIcon("Tomato Ketchup")).toBe("canned-food");
    expect(productIcon("Olive Oil")).toBe("olive");
    expect(productIcon("Chicken masala")).toBe("jar");
    expect(productIcon("Coriander Powder")).toBe("jar");
    expect(productIcon("Coriander")).toBe("herb");
    expect(productIcon("Eggplant")).toBe("eggplant");
  });

  it("covers the misspellings already in real data", () => {
    expect(productIcon("Youghurt")).toBe("bowl-with-spoon");
    expect(productIcon("Frozen parata")).toBe("flatbread");
    expect(productIcon("Kalo jeera")).toBe("jar");
  });

  it("gives the utilities their own icons", () => {
    expect(productIcon("Gas Cylinder")).toBe("fire");
    expect(productIcon("Electricity Recharge")).toBe("high-voltage");
    expect(productIcon("Wifi Bill")).toBe("antenna-bars");
  });

  it("returns null for something it does not know, so a letter tile shows", () => {
    expect(productIcon("General expense")).toBeNull();
    expect(productIcon("Birthday candles")).toBe("candle");
  });

  it("only names icons that are actually bundled", () => {
    // Catches a rule added without re-running scripts/product-icons.mjs.
    const named = [...CATALOG.map((s) => s.name), "Gas", "Wifi", "Electricity", "Soap", "Salt"]
      .map(productIcon)
      .filter((n): n is string => n !== null);
    for (const n of named) expect(PRODUCT_ICON_PATHS[n], n).toBeTruthy();
  });

  it("has an icon for nearly all of the starter catalog", () => {
    const missing = CATALOG.map((s) => s.name).filter((n) => productIcon(n) === null);
    // These have no honest emoji and get a letter tile.
    expect(missing).toEqual(["Papaya", "Radish", "Pomegranate", "Jackfruit"]);
  });
});
