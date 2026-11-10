import { describe, expect, it } from "vitest";
import { describeMessage } from "@/lib/meta/client";

describe("describeMessage", () => {
  it("keeps plain text", () => {
    expect(describeMessage({ id: "1", message: "Bonjour" })).toBe("Bonjour");
  });

  it("reads a card's title and subtitle when there is no text", () => {
    expect(
      describeMessage({
        id: "2",
        message: "",
        attachments: { data: [{ generic_template: { title: "Ta ressource", subtitle: "Clique ici" } }] },
      })
    ).toBe("Ta ressource\nClique ici");
  });

  it("marks images and returns empty for a button message Meta leaves blank", () => {
    expect(describeMessage({ id: "3", attachments: { data: [{ image_data: {} }] } })).toBe("📷");
    expect(describeMessage({ id: "4" })).toBe("");
  });
});
