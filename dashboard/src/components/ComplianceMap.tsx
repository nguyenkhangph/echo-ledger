import { useState } from "react";
import { LEDGER_ADDRESS, useLedger } from "../data/ledger";
import { pipelineStats } from "../data/pipeline";
import { Reveal, SectionHeading } from "./SiteChrome";

type Duty = { cite: string; source: string; quote: string; answer: string; evidence: (ctx: Ctx) => { href: string; label: string } };
type Ctx = { decisions: number | null; settled: number | null; trust: number | null; latest: string | null; sponsored: number; echoes: number };

const DUTIES: Duty[] = [
  {
    cite: "Art. 12(1)",
    source: "EU AI Act · record-keeping",
    quote: "High-risk AI systems shall technically allow for the automatic recording of events (logs) over the lifetime of the system.",
    answer: "Every decision, settlement and trust change is an on-chain event written by Chainlink CRE. The log is append-only and the agent holds no key that could edit or delete it.",
    evidence: (c) => ({ href: "#ledger", label: c.decisions == null ? "Open the ledger" : `${c.decisions} decisions · ${c.settled} settlements · ${c.trust} trust events` }),
  },
  {
    cite: "Art. 13",
    source: "EU AI Act · transparency to deployers",
    quote: "Operation sufficiently transparent to enable deployers to interpret a system's output and use it appropriately.",
    answer: "Each decision has a reasoning card (sources, evidence, debate, risk rules), a plain-language Certificate of Record and an open-source verifier that re-derives the results.",
    evidence: (c) => ({ href: c.latest ? `/record/${c.latest}` : "#audit", label: c.latest ? "Read a Certificate of Record" : "Open the audit" }),
  },
  {
    cite: "Art. 91(2)(c)",
    source: "MiCA · market manipulation",
    quote: "Disseminating information through the media, including the internet, which gives, or is likely to give, false or misleading signals.",
    answer: "A claim that is only repeated counts for nothing. Reposts are folded into the voice they echo, so amplification alone can never push a narrative over the bar.",
    evidence: (c) => ({ href: "#radar", label: `${c.echoes} echoes discounted · see the echo flip` }),
  },
  {
    cite: "Art. 91(3)(c)",
    source: "MiCA · voicing opinions while holding positions",
    quote: "Using access to traditional or electronic media to comment on a crypto-asset while having previously taken positions on it, without disclosing the conflict.",
    answer: "Every source builds a public track record that nobody can edit: each settled call moves its trust score on-chain, win or lose.",
    evidence: () => ({ href: "/scorecard", label: "Open the source leaderboard" }),
  },
  {
    cite: "16 CFR §255.5",
    source: "FTC Endorsement Guides · material connections",
    quote: "A connection between an endorser and the seller that could affect the weight of the endorsement must be clearly disclosed.",
    answer: "Posts flagged as sponsored or paid promotion are set aside before scoring, and shown as filtered rather than hidden.",
    evidence: (c) => ({ href: "#radar", label: c.sponsored ? `${c.sponsored} sponsored posts filtered in the last 24 h` : "Sponsored posts are tagged in the event feed" }),
  },
  {
    cite: "Control design",
    source: "Segregation of duties",
    quote: "The party that makes a decision should not be the party that records, settles and scores it.",
    answer: "The agent proposes. CRE workflows re-check prices and risk limits, settle with a 3-source median and score sources. The contract accepts reports only from the Keystone forwarder.",
    evidence: () => ({ href: "#cre", label: "See the three CRE workflows" }),
  },
];

function useCtx(): Ctx {
  const ledger = useLedger();
  const s = ledger.status === "live" ? ledger.snapshot : ledger.status === "error" ? ledger.snapshot : undefined;
  const latest = s ? [...s.positions].filter((p) => p.settled).sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt))[0]?.id ?? null : null;
  return {
    decisions: s ? s.positions.length : null,
    settled: s ? s.positions.filter((p) => p.settled).length : null,
    trust: s ? s.trustUpdates.length : null,
    latest,
    sponsored: pipelineStats.sponsoredInWindow,
    echoes: pipelineStats.echoesTotal,
  };
}

export function ComplianceMap() {
  const ctx = useCtx();
  return (
    <section className="page-section" id="compliance" aria-labelledby="compliance-title">
      <Reveal>
        <SectionHeading id="compliance-title" eyebrow="Built for scrutiny · legal mapping" title="Each rule a regulator cares about, matched to evidence you can open" />
        <p className="cre__intro mono-font">
          Finfluencer manipulation and opaque AI decisions are what the rules below target. Echo Ledger was designed so that every answer points to a record,
          not a promise.
        </p>
      </Reveal>
      <div className="duties">
        {DUTIES.map((duty, index) => {
          const ev = duty.evidence(ctx);
          return (
            <Reveal key={duty.cite} delay={index * 60} className="duty">
              <article>
                <header className="duty__head">
                  <span className="duty__cite">{duty.cite}</span>
                  <span className="duty__source mono-font">{duty.source}</span>
                </header>
                <blockquote className="duty__quote">{duty.quote}</blockquote>
                <p className="duty__answer"><b className="mono-font">Echo Ledger</b> {duty.answer}</p>
                <a className="duty__evidence mono-font" href={ev.href}>Evidence → {ev.label}</a>
              </article>
            </Reveal>
          );
        })}
      </div>
      <p className="duties__note mono-font">
        Illustrative mapping for a practice system on a test network; it is not legal advice and does not claim regulatory compliance. Quotations are abridged or paraphrased
        from Regulation (EU) 2024/1689 (AI Act), Regulation (EU) 2023/1114 (MiCA) and 16 CFR Part 255.
      </p>
    </section>
  );
}

const SOL = (address: string) => `interface IEchoLedger {
    struct KolTrust { uint256 score; uint256 trades; }
    function kolTrust(bytes32 kolId) external view returns (KolTrust memory);
}

contract SignalWeighter {
    IEchoLedger constant LEDGER = IEchoLedger(${address});

    /// Weight any call by the source's public, uneditable track record (0..10000 bps).
    function weightOf(string calldata handle) external view returns (uint256) {
        IEchoLedger.KolTrust memory t = LEDGER.kolTrust(keccak256(bytes(handle)));
        return t.trades == 0 ? 5000 : t.score;
    }
}`;

const TS = (address: string) => `import { createPublicClient, http, keccak256, parseAbi, toBytes } from "viem";
import { sepolia } from "viem/chains";

const client = createPublicClient({ chain: sepolia, transport: http() });
const trust = await client.readContract({
  address: "${address}",
  abi: parseAbi(["function kolTrust(bytes32) view returns ((uint256 score, uint256 trades))"]),
  functionName: "kolTrust",
  args: [keccak256(toBytes("glassnode"))],
});`;

export function BuildOnRecord() {
  const [tab, setTab] = useState<"sol" | "ts">("sol");
  const [copied, setCopied] = useState(false);
  const ledger = useLedger();
  const s = ledger.status === "live" ? ledger.snapshot : ledger.status === "error" ? ledger.snapshot : undefined;
  const sample = s?.kols.find((k) => k.label === "glassnode") ?? s?.kols[0];
  const address = LEDGER_ADDRESS || "0x88fd1895d9b4BD28Cf641281b9AA1eF787b8DAd0";
  const code = tab === "sol" ? SOL(address) : TS(address);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section className="page-section" id="build" aria-labelledby="build-title">
      <Reveal>
        <div className="build">
          <div className="build__text">
            <SectionHeading id="build-title" eyebrow="Composable reputation" title="The track record is a public good" />
            <p className="mono-font">
              Trust scores live in the contract, not in our database. Any contract or agent can read them with one call and weight a source by what its past
              calls actually did.
            </p>
            {sample && (
              <div className="build__live mono-font">
                <span>live read · kolTrust("{sample.label ?? "source"}")</span>
                <strong>{"{"} score: {sample.score}, trades: {sample.trades} {"}"}</strong>
              </div>
            )}
          </div>
          <div className="build__code">
            <div className="build__tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "sol"} className={tab === "sol" ? "is-active" : ""} onClick={() => setTab("sol")}>Solidity</button>
              <button type="button" role="tab" aria-selected={tab === "ts"} className={tab === "ts" ? "is-active" : ""} onClick={() => setTab("ts")}>TypeScript · viem</button>
              <button type="button" className="build__copy" onClick={copy}>{copied ? "copied ✓" : "copy"}</button>
            </div>
            <pre className="mono-font"><code>{code}</code></pre>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
