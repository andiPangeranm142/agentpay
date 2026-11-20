# DoraHacks Submission Draft — AgentPay

> **DRAFT — 20 Nov 2026.** For the Aevum Builder Challenge #1 submission
> form at <https://dorahacks.io/hackathon/qday/detail>. Every `[TODO]` must
> be replaced with the real value before submitting. Nothing in this
> draft claims a feature that is not built; the build workstream
> confirms each claim before the coordinator submits.
>
> Submission deadline: **11 Dec 2026, 16:00 HKT (08:00 UTC / 15:00 WIB)**.
> Submit early — the portal gets slow at the end (starter kit advice).

---

## Project title

**AgentPay**

## One-line pitch

An AI agent pays your recurring bills in tUSD8 from a vault you own —
inside a payee allowlist, spending limits, and an expiry you set — with
instant revocation and a full on-chain audit trail.

## Track

**Native AI Assistants**

## Links

| Field | Value |
| --- | --- |
| GitHub repository (public) | `[TODO — public repo URL]` |
| Live demo | `[TODO — demo URL; must work without logging in]` |
| Demo video | `[TODO — video URL, 3–5 min walkthrough]` |
| Deployed contracts (Aevum testnet, chain 44005) | AgentPayVault `[TODO — address + explorer link]`; AgentRegistry (optional) `[TODO — address + explorer link]` |
| Deployment commit | `[TODO — exact commit hash that was deployed]` |
| Example transactions | `[TODO — tx hashes + explorer links: deposit, session creation, agent payment, revoke]` |

## Full description

### The problem

Recurring payments are still manual, brittle, or over-privileged.
Paying every subscription, invoice, or scheduled transfer by hand is
slow and easy to miss — but handing an AI agent your wallet key (or an
unlimited token approval) so it can "pay for you" gives it your whole
balance. A compromised key, a runaway loop, or a prompt-injection
attack can drain everything, and most "agent pays" demos settle
off-chain or on another network, leaving no verifiable record of who
paid whom, how much, and under what authority.

### The solution

AgentPay splits **money** from **permission**:

- **The vault holds the money.** tUSD8 sits in `AgentPayVault`, a
  contract owned by you. Only the owner can deposit and withdraw.
- **The agent holds a narrow session key.** The owner creates a session
  authorising one agent address to pay **only** allowlisted payees,
  **only** up to a per-transaction limit and a daily limit, and **only**
  until an expiry timestamp. The session key can never withdraw funds
  to itself, change the allowlist, or extend its own limits.
- **Revocation is instant and on-chain.** `revokeSession` takes effect
  in the next block; the agent's next payment reverts.
- **Every payment is auditable.** Each payment emits an event with the
  session id, payee, amount, and bill reference — readable from the
  explorer or the audit reader in the repo.
- **Scheduling is off-chain; enforcement is on-chain.** A small agent
  runner watches a bill schedule and calls `pay` when a bill is due.
  If the runner is compromised or buggy, the contract — not the runner
  — is the last line of defence.

### How it works

1. The owner deposits tUSD8 into the vault and creates a session for
   the agent (allowlisted payees, per-transaction limit, daily limit,
   expiry) — one signature.
2. The agent runner watches `bills.json`. When a bill is due, it calls
   `pay(sessionId, payee, amount, billRef)` with the session key.
3. The vault enforces every rule on-chain: caller is the session agent,
   session not revoked, not expired, payee allowlisted, amount within
   the per-transaction limit, and today's total within the daily limit.
   Only then does the tUSD8 move, and a `PaymentExecuted` event is
   emitted.
4. The owner watches the audit log in the dashboard and can revoke the
   session or withdraw funds at any time.

### What is on-chain (Aevum testnet, chain 44005)

- `AgentPayVault` — vault + session registry + limits + revoke.
  `[TODO — address]`
- `AgentRegistry` (optional) — our own ERC-8004-style identity
  registry for the agent. `[TODO — address, or remove if not shipped]`
- All value movement is tUSD8
  (`0x456569838f1d43009A91ebA4263147Afd7233483`) on Aevum testnet.
  Nothing settles on another chain.

### Tech stack

Solidity + Foundry (Shanghai EVM target), tUSD8 (EIP-2612 / EIP-3009),
Node.js 22 + TypeScript agent runner, `[TODO: web framework]` owner
dashboard, HTTPS JSON-RPC polling with chunked `eth_getLogs` reads
(Aevum limits log queries to 1,000 blocks and has no working WebSocket
RPC, per the starter kit).

### Team

`[TODO — list every team member; each must be registered on DoraHacks.]`

---

## How AgentPay meets each judging criterion

Weights below are from the starter kit judging rubric (total 100):
Innovation 20, UX 15, technical 15, utility 15, safety 15, demo 10,
docs 10. Note: the DoraHacks challenge page additionally lists an
8th criterion, "Ecosystem contribution (reusable, open source)", with
no weight published — covered last below.

### 1. Innovation and originality (20)

- **Money/permission split as the core primitive.** Most agent-payment
  demos give the agent a funded wallet; AgentPay gives the agent
  *permission* while the owner keeps the money. The session key is
  useless outside its allowlist, limits, and expiry window.
- **A complete agentic payment primitive, not a checkout clone.**
  Sessions + allowlist + dual limits (per-tx and daily) + expiry +
  instant revoke + bill-referenced audit events, composed into one
  contract designed for autonomous recurring payments.
- **Own ERC-8004-style identity layer (optional).** Because QDay's
  official ERC-8004 registry is still in internal testing and not open
  for this challenge, AgentPay deploys its own reference registry so
  the agent has a discoverable on-chain identity — a building block
  other Aevum builders can reuse. `[TODO — keep only if shipped.]`

### 2. User experience and presentation (15)

- Owner dashboard: deposit, create session, watch the audit log, and
  revoke — each a single action with clear status feedback.
- Plain-language errors: when a payment is refused (payee not
  allowlisted, over the limit, expired, revoked), the runner and
  dashboard say *which rule* blocked it.
- `[TODO — confirm before submit: responsive desktop/mobile; first-time
  user can complete a deposit + session + payment from the README
  alone.]`

### 3. Technical quality and platform integration (15)

- Deep, correct Aevum use: Shanghai-safe bytecode, legacy
  transactions, chunked log reads for the 1,000-block limit, HTTPS
  polling (no WebSocket), tUSD8 permit/EIP-3009 awareness.
- Session-key policy engine implemented in our own contract — exactly
  the design the starter kit recommends ("For budgets, limits, expiry
  and revoke, write them into your own contract"), since QDay's
  bundler/paymaster addresses and SDK are not published yet.
- `[TODO — test count + coverage: every security rule has a test —
  allowlist rejection, per-tx limit, daily limit, expiry, revoke,
  non-agent caller, double payment; fork tests run against real tUSD8.]`

### 4. Real-world utility and market potential (15)

- Recurring bills are a real, universal need — rent, subscriptions,
  payroll, supplier invoices — and the "agent that pays for you" is
  only adoptable if the owner can bound what it can do. AgentPay is
  that bound.
- Path to scale: gasless payments (EIP-3009 relayer), QDay ERC-4337
  smart accounts + paymaster when published, x402 pay-per-use bills,
  keeper-based scheduling, multisig owners — then mainnet (Q1 2027).

### 5. Safety, trust and controls (15)

- Least privilege by construction: the session key can only pay
  allowlisted payees within limits; it cannot withdraw, change rules,
  or extend itself.
- Blast radius capped at the daily limit, to allowlisted payees only,
  until revoke or expiry.
- Instant on-chain revocation; owner key never touches the agent host;
  full on-chain audit trail with bill references; testnet only, no
  real funds.

### 6. Demo (10)

- `[TODO — video URL]`: a 3–5 minute walkthrough showing the full
  end-to-end flow on testnet — deposit, session creation, agent
  payment, a refused payment (over-limit or non-allowlisted payee),
  and instant revoke — with visible transaction hashes and explorer
  links.
- Live demo link above works without logging in. Top-5 finalists
  present live on Demo Day, 15 Dec 2026.

### 7. Documentation (10)

- README with problem, architecture (Mermaid diagrams), tech stack,
  testnet addresses, full environment-variable spec, step-by-step
  reproduction a stranger can follow on a local fork, contract API
  reference, known limitations, and roadmap.
- Platform integration notes documenting exactly which QDay features
  are used, which are roadmap, and why — with sources.

### 8. Ecosystem contribution (DoraHacks page criterion, no weight published)

- Open-source (permissive license `[TODO — MIT/Apache 2.0]`), modular
  contracts other builders can reuse as a session-key / spending-limit
  primitive for their own agents.
- Optional ERC-8004-style registry as shared infrastructure for agent
  identity on Aevum. `[TODO — keep only if shipped.]`

---

## Pre-submit checklist (from the starter kit)

- [ ] Submitted before the deadline (11 Dec 2026, 16:00 HKT).
- [ ] Repo is public and opens in a logged-out browser.
- [ ] No private keys, `.env` files, or API keys in the repo or its
      commit history.
- [ ] A stranger can run the project from the README.
- [ ] Contracts and payments are on Aevum testnet, not another network.
- [ ] The demo link works without logging in.
- [ ] Every team member is listed and registered.
- [ ] The repo has an open-source license, and every template or
      snippet reused is credited (Aevum Starter Kit: MIT, PQA Labs —
      keep its LICENSE / notice if kit code is reused).
- [ ] Contract addresses + exact deployment commit + example tx hashes
      are in the README and in this submission.
- [ ] Demo video uploaded and linked (3–5 min).

---

## Sources (checked 20 Nov 2026)

- Challenge page: <https://dorahacks.io/hackathon/qday/detail>
- Starter kit docs: <https://aevum-starter-kit.vercel.app/docs>
- QDay build page: <https://qday.io/build>
- QDay wiki: <https://wiki.qday.info> (chain parameters, token list,
  "Why QDay")
- Judging weights: starter kit PDF as read by the coordinator
  (Innovation 20, UX 15, technical 15, utility 15, safety 15, demo 10,
  docs 10).
