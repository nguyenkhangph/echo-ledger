import { useMemo } from "react";
import { auditLedger } from "@echo/shared/audit";
import { useLedger } from "../data/ledger";

/** The four numbers a judge should see first, all read from the chain and re-derived in this browser. */
export function ProofStrip() {
  const ledger = useLedger();
  const snapshot = ledger.status === "live" ? ledger.snapshot : ledger.status === "error" ? ledger.snapshot : undefined;
  const audit = useMemo(() => (snapshot ? auditLedger(snapshot) : null), [snapshot]);

  const settled = snapshot?.positions.filter((p) => p.settled && p.side !== "NONE") ?? [];
  const total = settled.reduce((sum, p) => sum + (p.pnlBps ?? 0), 0);
  const wins = settled.filter((p) => (p.pnlBps ?? 0) > 0).length;
  const losses = settled.filter((p) => (p.pnlBps ?? 0) < 0).length;
  const dash = "—";

  const cells = [
    {
      href: "/scorecard",
      value: snapshot ? `${total >= 0 ? "+" : ""}${total} bps` : dash,
      label: "practice PnL",
      sub: snapshot ? `${wins} wins · ${losses} losses` : "reading Sepolia…",
      tone: total >= 0 ? "win" : "loss",
    },
    {
      href: "#audit",
      value: audit ? `${audit.passed}/${audit.total}` : dash,
      label: "audit checks pass",
      sub: "re-derived in your browser",
      tone: audit && !audit.ok ? "loss" : "win",
    },
    {
      href: "#ledger",
      value: snapshot ? String(snapshot.positions.length) : dash,
      label: "decisions on-chain",
      sub: snapshot ? `${settled.length} settled · ${snapshot.positions.filter((p) => p.side === "NONE").length} rejected` : "Ethereum Sepolia",
      tone: "plain",
    },
    {
      href: "#cre",
      value: snapshot ? String(snapshot.trustUpdates.length) : dash,
      label: "trust updates",
      sub: "written by Chainlink CRE",
      tone: "plain",
    },
  ];

  return (
    <div className="proof-strip" aria-label="Track record read from Ethereum Sepolia">
      {cells.map((cell) => (
        <a key={cell.label} className={`proof-strip__cell proof-strip__cell--${cell.tone}`} href={cell.href}>
          <strong className="display-font">{cell.value}</strong>
          <span className="proof-strip__label mono-font">{cell.label}</span>
          <span className="proof-strip__sub mono-font">{cell.sub}</span>
        </a>
      ))}
    </div>
  );
}
