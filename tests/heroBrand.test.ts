import { SlotCore } from "@deepseek-ai/dsh-client-ui-slots";
import { describe, expect, it } from "vitest";

import { AZU_ICON_SRC } from "../src/client/assets/azuIcon.ts";
import {
  MuziHeroBrandMark,
  registerMuziHeroBrandMark,
  type CompatibleHeroBrandSlots,
} from "../src/client/heroBrand.tsx";
import { en, zh } from "../src/client/locales.ts";
import { AzBrand } from "../src/client/sidebar/AzBrand.tsx";

function registerSlots(): SlotCore {
  const slots = new SlotCore();
  slots.register({
    name: "root",
    children: {
      conversation: { kind: "single", scope: "root" },
    },
  } as never, (() => null) as never);
  slots.register({
    name: "conversation",
    children: {
      "conversation.hero.brand.mark": { kind: "single", scope: "root" },
    },
  } as never, (() => null) as never);
  return slots;
}

describe("Muzi brand", () => {
  it("renders the bundled 34px decorative avatar without the fish motion class", () => {
    const mark = MuziHeroBrandMark({ size: 34, className: "fish-motion" });

    expect(mark.type).toBe("img");
    expect(mark.props).toMatchObject({
      src: AZU_ICON_SRC,
      width: 34,
      height: 34,
      alt: "",
      "aria-hidden": "true",
      className: "muziHeroBrandMark",
    });
    expect(mark.props.className).not.toContain("fish-motion");
  });

  it("renders the approved phrase inside plugin-owned sidebar chrome", () => {
    expect(zh["brand.name"]).toBe("Azu 工作台");
    expect(zh["brand.tagline"]).toBe("Azu 在生长");
    expect(en["brand.name"]).toBe("Azu 工作台");
    expect(en["brand.tagline"]).toBe("Azu is growing");

    const brand = AzBrand({ tagline: en["brand.tagline"] });
    const copy = brand.props.children[1];
    expect(copy.props.children[0].props.children).toBe("Azu 工作台");
    expect(copy.props.children[1].props.children).toBe("Azu is growing");
  });

  it("registers and releases the existing Hero mark occupant", () => {
    const slots = registerSlots();
    const compatible = slots as unknown as CompatibleHeroBrandSlots;
    const releaseMark = registerMuziHeroBrandMark(compatible);

    expect(slots.entries("conversation.hero.brand.mark")).toHaveLength(1);

    releaseMark();
    expect(slots.entries("conversation.hero.brand.mark")).toHaveLength(0);
  });
});
