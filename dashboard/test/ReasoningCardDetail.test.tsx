import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { exampleCards } from "@echo/shared/fixtures";
import { ReasoningCardDetail } from "../src/ReasoningCardDetail";

describe("ReasoningCardDetail", () => {
  test.each(exampleCards)("renders fixture $card_id without throwing", (card) => {
    const html = renderToStaticMarkup(<ReasoningCardDetail card={card} />);

    expect(html).toContain(card.card_id);
    expect(html).toContain(card.token);
    expect(html).toContain("Risk rules");
    expect(html).toContain("On-chain reference");
  });
});