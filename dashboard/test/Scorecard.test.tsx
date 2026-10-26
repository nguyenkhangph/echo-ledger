import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Scorecard } from "../src/Scorecard";
import { getMockScorecardData } from "../src/data/scorecard";

describe("Scorecard", () => {
  test("renders portfolio and KOL scoreboard without throwing", () => {
    const data = getMockScorecardData();
    const html = renderToStaticMarkup(<Scorecard data={data} />);

    expect(html).toContain("Performance scorecard");
    expect(html).toContain("KOL leaderboard");
    expect(html).toContain("alice-crypto");
    expect(html).toContain("momentum-desk");
    expect(html).toContain("Cumulative PnL");
  });

  test("derives expected side-aware portfolio totals", () => {
    const { portfolio } = getMockScorecardData();

    expect(portfolio.totalPositions).toBe(11);
    expect(portfolio.openPositions).toBe(2);
    expect(portfolio.settledPositions).toBe(9);
    expect(portfolio.byToken).toHaveLength(3);
    expect(portfolio.equityCurve).toHaveLength(9);
    expect(portfolio.byToken.find((token) => token.token === "SOL")?.winRate).toBe(100);
    expect(portfolio.byToken.find((token) => token.token === "ETH")?.winRate).toBe(67);
  });

  test("keeps echoes separate and exposes declining trust", () => {
    const momentumDesk = getMockScorecardData().kols.find((kol) => kol.handle === "momentum-desk");

    expect(momentumDesk?.echoCalls).toBe(6);
    expect(momentumDesk?.trend).toBe("down");
    expect(momentumDesk?.trendDelta).toBeLessThan(0);
  });
});