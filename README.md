<p align="center">
  <img src="logo/stockchain.svg" alt="StockChain logo" width="110" />
</p>

<h1 align="center">FintasTech · StockChain Research Lab</h1>

<p align="center">
  <b>An open-source lab where rule-based multi-agent equity research meets a transparent, on-chain auditable paper-trading vault.</b><br/>
  <i>Every signal is reproducible. Every allocation is auditable. Every NAV move is backed by real market data.</i>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" />
  <img src="https://img.shields.io/badge/python-3.11+-3776AB?logo=python&logoColor=white" alt="Python 3.11+" />
  <img src="https://img.shields.io/badge/solidity-0.8.24-363636?logo=solidity" alt="Solidity 0.8.24" />
  <img src="https://img.shields.io/badge/next.js-15-000000?logo=nextdotjs" alt="Next.js 15" />
  <img src="https://img.shields.io/badge/i18n-中文%20%2F%20EN-8b5cf6" alt="Bilingual" />
</p>

<p align="center">
  <a href="#-english">English</a> · <a href="#-中文">中文</a> · <a href="./DISCLAIMER.md">Disclaimer</a>
</p>

> 💡 **No real money, ever.** The whole stack runs on a local Hardhat chain with free test ETH and a mock stablecoin (mUSDC) faucet. The vault contract *architecturally refuses* real assets and real networks. **Never send real funds to any address shown in this project.**

---

## 🇬🇧 English

### What is this?

Most "AI trading" repos are black boxes. This project asks a different question:

> **How do you make an AI's investment logic *observable* — so anyone can replay it, challenge it, and learn from it?**

It answers with three connected layers, all runnable locally with one command:

1. **Multi-agent research (Python)** — 14 master-investor heuristics (Buffett, Graham, Lynch, Soros, Dalio…) + 4 core analysts (technical / fundamental / valuation / sentiment) score every stock in parallel and fuse into one directional signal with confidence. Pure rules — no black-box ML — so every vote can be traced.
2. **Paper-trading & backtesting** — the signals drive a local virtual portfolio (live Yahoo Finance data, US / HK / CN A-shares) and a walk-forward backtester with an equal-weight buy-and-hold benchmark for honest comparison.
3. **On-chain auditability (Solidity)** — signals are anchored into a `SignalRegistry` with a `keccak256` reasoning hash, and a fund-grade vault (NAV per share, high-water mark, performance fee, circuit breaker) tracks the strategy with mock USDC. Databases can be edited; the chain can't.

### Pages

| Route         | What you get                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `/`           | One-click preset portfolios (US tech, HK blue chips, A-share consumer…) that spin up a paper book |
| `/simulation` | Virtual portfolio: AI research cycles, manual orders, equity curve, full trade log                |
| `/analysis`   | Single-stock deep dive: 18 analysts' votes + reasoning, price chart with MA20/50, risk gauge      |
| `/backtest`   | Walk-forward replay: equity curve vs benchmark, Sharpe, max drawdown, volatility, excess return   |
| `/vault`      | On-chain vault dApp: mUSDC faucet, deposit/withdraw, "analyse & anchor on-chain", allocation table |
| `/settings`   | Risk preference (conservative ≤10% / moderate ≤20% / aggressive ≤35% per symbol), applied app-wide |

The entire UI is bilingual (中文 / EN) — switch live from the sidebar.

### Architecture

```
                ┌───────── Yahoo Finance (live + historical) ─────────┐
                ▼                                                     ▼
      ┌──────────────────┐                               ┌────────────────────────┐
      │ 14 master models │◄──── weighted fusion ───────► │ 4 core analyst modules │
      │ (Buffett, Graham,│      + confidence             │ tech / fund / val / sen│
      │  Lynch, …)       │                               └────────────┬───────────┘
      └────────┬─────────┘                                            │
               └───── composite signal (bull / bear / neutral) ───────┘
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
        ▼                               ▼                               ▼
┌──────────────────┐          ┌────────────────────┐         ┌───────────────────────┐
│ Paper-trade book │          │ Walk-forward       │         │ Oracle bridge / wallet│
│ (local JSON,     │          │ backtest + equal-  │         │ → SignalRegistry.push │
│  crash-safe)     │          │ weight benchmark   │         │ → Vault.rebalance     │
└──────────────────┘          └────────────────────┘         │ → Vault.reportPerf(Δ) │
                                        │                    └───────────────────────┘
                           Next.js dApp (React 19 + ethers v6)
                             ↕ Hardhat local chain (chainId 31337)
```

### Quick start

**Prerequisites** · Node 20+ · Python 3.11+ · Git · a Chromium browser with [MetaMask](https://metamask.io) (only for `/vault`)

**1. One command boots everything**

```bash
git clone https://github.com/JasonJr2005/StockChain-Onchain-AI-Stock-Research-Lab.git
cd StockChain-Onchain-AI-Stock-Research-Lab
./start.sh
```

First run installs all dependencies, then starts the research API (`:8000`), the dApp (`:3000`), a local Hardhat chain (`:8545`), deploys the contracts, syncs their addresses to the frontend, and opens the app.

- `./start.sh --no-chain` — skip the blockchain (faster, everything except `/vault` works)
- `./stop.sh` — stop everything

**2. Hook up MetaMask** (for the `/vault` page)

- Add network: **Hardhat Localhost** · RPC `http://127.0.0.1:8545` · Chain ID `31337` · Symbol `ETH`
- Import Hardhat's public dev Account #0 (10,000 test ETH + `ORACLE_ROLE`):
  `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
  *(This key is printed in Hardhat's docs and identical on every machine — local testing only.)*
- Prefer your own account? `FUND_TO=0xYourAddress npm run fund:local` in `blockchain/` sends it 100 test ETH.

**3. A five-minute tour**

1. On the landing page, click any preset → one research cycle runs and a paper portfolio appears in `/simulation`.
2. Open `/analysis`, search any ticker (`AAPL` · `0700.HK` · `600519.SS`) → 18 analysts vote, with reasoning and a price chart.
3. In `/vault`: **Claim faucet** (10,000 mUSDC, hourly) → **Deposit** → enter a watch-list → **Analyse & anchor on-chain**. Signals are signed into the registry and the vault records conviction-weighted allocations.

**4. Optional: let NAV move with the market**

```bash
cd blockchain
npx hardhat run scripts/oracle-bridge.js --network localhost
```

Every cycle (default 15 min) the oracle computes the capital-weighted return of the vault's actual on-chain allocation from fresh prices and pushes `reportPerformance(deltaBps)` — NAV, high-water mark and share value evolve with real data. There is also `scripts/auto_research_loop.py` for cron-driven paper-book rebalancing.

### API overview (`http://127.0.0.1:8000`, docs at `/docs`)

| Endpoint                       | Returns                                                              |
| ------------------------------ | -------------------------------------------------------------------- |
| `GET /v1/analyze/{symbol}`     | Full 18-analyst research bundle (cached ~2 min)                      |
| `GET /v1/batch-analyze`        | Up to 20 symbols, researched concurrently                            |
| `GET /v1/history/{symbol}`     | Daily OHLCV + MA20/MA50 (`period=1mo…2y`)                            |
| `GET /v1/search?q=`            | Ticker search across US / HK / CN markets                            |
| `POST /v1/backtest`            | Walk-forward replay + equal-weight benchmark + risk metrics          |
| `POST /v1/simulation/*`        | Paper ledger: state / buy / sell / close / rebalance / reset         |
| `GET /v1/presets` · `/masters` | Demo watch-lists · master-investor roster                            |

### Project layout

```
├── src/fintastech/         # Python research pipeline
│   ├── agents/             #   4 core analysts + 14 master models + orchestrator
│   ├── api/                #   FastAPI service
│   ├── backtesting/        #   walk-forward engine w/ benchmark
│   ├── simulation/         #   crash-safe paper-trading ledger
│   └── data/               #   Yahoo provider + offline mock provider
├── tests/                  # offline pytest suite (mock market data)
├── blockchain/             # Hardhat workspace — contracts, deploy & oracle scripts
│   └── contracts/          #   FintasVault · FintasSignalRegistry · MockUSDC
├── frontend/               # Next.js dApp (App Router)
│   └── src/lib/i18n        #   zero-dependency bilingual dictionary
└── DISCLAIMER.md           # full educational disclaimer (EN + 中文)
```

### Tech stack

| Layer           | Choice                                                                       |
| --------------- | ---------------------------------------------------------------------------- |
| Research & data | Python 3.11+, FastAPI, yfinance, pandas, NumPy, thread-pooled orchestrator   |
| Smart contracts | Solidity 0.8.24, OpenZeppelin 5, Hardhat                                     |
| Frontend        | Next.js 15, React 19, Tailwind CSS, ethers v6, hand-rolled SVG charts        |
| Tests           | pytest (offline, mock market) · Hardhat/Chai (26 contract tests)             |

### Tests

```bash
source .venv/bin/activate && pytest        # backend — runs fully offline
cd blockchain && npx hardhat test          # contracts
```

### Safety guardrails (by design, not by promise)

- **Mock-only asset**: the vault's constructor reverts unless the ERC-20 symbol starts with `m` (e.g. `mUSDC`) — it cannot be pointed at a real stablecoin.
- **Chain allowlist**: deploy script and UI both refuse every network except Hardhat local (31337) and Sepolia (11155111).
- **Bounded oracle**: NAV updates are capped at ±5% per report and rate-limited to one per 15 minutes.
- **Circuit breaker**: a guardian can trip it at any time — NAV is forced back to 1.0 and depositors exit 1:1 on principal via `emergencyWithdraw`.
- **Fee cap**: performance fee ≤ 20%, charged only on profit above the high-water mark.
- **Paper-only ledger**: the simulator is long-only, writes a local JSON file, and contains no broker or exchange integration of any kind.

### License & disclaimer

MIT © 2026 [JasonJr](./LICENSE). For education and research only — outputs are descriptive research signals, **not investment advice**, and no real trading is performed or possible. Full terms in [DISCLAIMER.md](./DISCLAIMER.md).

---

## 🇨🇳 中文

### 这是什么？

多数「AI 炒股」开源项目是黑盒。这个项目换了一个问法：

> **怎么让 AI 的投资逻辑「可被观察」——让任何人都能复现它、质疑它、并从中学习？**

答案由三层组成，一条命令即可全部本地跑起来：

1. **多智能体研究（Python）**—— 14 位大师启发式模型（巴菲特、格雷厄姆、林奇、索罗斯、达利欧…）+ 4 位核心分析师（技术 / 基本面 / 估值 / 情绪）并行评分，融合成带置信度的综合方向。纯规则、无黑盒 ML，每一票都可回溯。
2. **模拟盘与回测**—— 信号驱动本地虚拟组合（Yahoo 实时行情，覆盖美股 / 港股 / A 股），配备滚动向前回测器，并用等权买入持有基准做诚实对比。
3. **链上可审计（Solidity）**—— 每条信号连同 `keccak256` 推理哈希写入 `SignalRegistry`；基金级金库（每份额 NAV、历史高水位、绩效费、熔断器）用 mock USDC 跟踪策略。数据库可以被改，链不行。

### 页面一览

| 路由          | 内容                                                                       |
| ------------- | -------------------------------------------------------------------------- |
| `/`           | 一键预设组合（美股科技 / 港股蓝筹 / A 股消费…），点击即生成模拟组合          |
| `/simulation` | 虚拟组合：AI 研究循环、手动下单、净值曲线、完整交易流水                      |
| `/analysis`   | 个股深研：18 位分析师投票 + 推理、带 MA20/50 的价格走势图、风险评估          |
| `/backtest`   | 历史回放：策略 vs 基准净值曲线、夏普、最大回撤、波动率、超额收益             |
| `/vault`      | 链上金库 dApp：mUSDC 水龙头、存取款、「AI 分析并上链」、链上分配表           |
| `/settings`   | 风险偏好（保守 ≤10% / 稳健 ≤20% / 进取 ≤35% 单标上限），全站生效             |

整站 UI 中英双语，侧边栏实时切换。

### 快速开始

**环境要求** · Node 20+ · Python 3.11+ · Git · Chromium 内核浏览器 + [MetaMask](https://metamask.io)（仅 `/vault` 需要）

**1. 一条命令启动全栈**

```bash
git clone https://github.com/JasonJr2005/StockChain-Onchain-AI-Stock-Research-Lab.git
cd StockChain-Onchain-AI-Stock-Research-Lab
./start.sh
```

首次运行自动安装全部依赖，然后启动研究 API（`:8000`）、dApp（`:3000`）、Hardhat 本地链（`:8545`），自动部署合约并把地址同步到前端，最后打开应用。

- `./start.sh --no-chain` —— 跳过区块链（更快，除 `/vault` 外全部可用）
- `./stop.sh` —— 一键全停

**2. 配置 MetaMask**（玩 `/vault` 时需要）

- 添加网络：**Hardhat Localhost** · RPC `http://127.0.0.1:8545` · Chain ID `31337` · 符号 `ETH`
- 导入 Hardhat 公开测试账户 #0（自带 10,000 测试 ETH 和 `ORACLE_ROLE`）：
  `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
  *（这是 Hardhat 官方文档公开的、每台机器相同的测试私钥，仅限本地测试。）*
- 想用自己的钱包？在 `blockchain/` 目录执行 `FUND_TO=0x你的地址 npm run fund:local` 即可充 100 测试 ETH。

**3. 五分钟上手**

1. 首页点任意预设组合 → 自动跑一轮研究循环，`/simulation` 出现模拟持仓。
2. 打开 `/analysis` 搜索任意代码（`AAPL` · `0700.HK` · `600519.SS`）→ 18 位分析师投票 + 推理 + 价格走势图。
3. 进入 `/vault`：**领取水龙头**（10,000 mUSDC，每小时一次）→ **存入** → 填自选股 → **AI 分析并上链**。信号签名写入注册表，金库记录按置信度加权的分配。

**4. 可选：让 NAV 随真实行情浮动**

```bash
cd blockchain
npx hardhat run scripts/oracle-bridge.js --network localhost
```

Oracle 每轮（默认 15 分钟）用最新价格计算金库链上真实持仓的加权收益并推送 `reportPerformance(deltaBps)` —— NAV、历史高水位、份额价值随真实数据演化。另有 `scripts/auto_research_loop.py` 支持 cron 定时自动调仓。

### API 一览（`http://127.0.0.1:8000`，交互文档见 `/docs`）

| 接口                            | 返回                                                    |
| ------------------------------- | ------------------------------------------------------- |
| `GET /v1/analyze/{symbol}`      | 完整 18 位分析师研究包（约 2 分钟缓存）                 |
| `GET /v1/batch-analyze`         | 最多 20 只标的，并发研究                                |
| `GET /v1/history/{symbol}`      | 日线 OHLCV + MA20/MA50（`period=1mo…2y`）               |
| `GET /v1/search?q=`             | 美股 / 港股 / A 股代码搜索                              |
| `POST /v1/backtest`             | 滚动向前回测 + 等权基准 + 风险指标                      |
| `POST /v1/simulation/*`         | 模拟账本：state / buy / sell / close / rebalance / reset |
| `GET /v1/presets` · `/masters`  | 演示监控列表 · 大师模型花名册                           |

### 目录结构

```
├── src/fintastech/         # Python 研究 pipeline
│   ├── agents/             #   4 位核心分析师 + 14 位大师模型 + 编排器
│   ├── api/                #   FastAPI 服务
│   ├── backtesting/        #   带基准的滚动向前回测引擎
│   ├── simulation/         #   崩溃安全的模拟盘账本
│   └── data/               #   Yahoo 数据源 + 离线 mock 数据源
├── tests/                  # 离线 pytest 套件（mock 行情）
├── blockchain/             # Hardhat 工作区 —— 合约、部署与 Oracle 脚本
│   └── contracts/          #   FintasVault · FintasSignalRegistry · MockUSDC
├── frontend/               # Next.js dApp（App Router）
│   └── src/lib/i18n        #   零依赖中英双语词典
└── DISCLAIMER.md           # 完整教学免责声明（中英）
```

### 技术栈

| 层        | 选型                                                                   |
| --------- | ---------------------------------------------------------------------- |
| 研究 / 数据 | Python 3.11+、FastAPI、yfinance、pandas、NumPy、线程池并发编排器        |
| 智能合约   | Solidity 0.8.24、OpenZeppelin 5、Hardhat                               |
| 前端       | Next.js 15、React 19、Tailwind CSS、ethers v6、手写 SVG 图表            |
| 测试       | pytest（离线 mock 行情）· Hardhat/Chai（26 个合约测试）                 |

### 测试

```bash
source .venv/bin/activate && pytest        # 后端 —— 完全离线可跑
cd blockchain && npx hardhat test          # 合约
```

### 安全护栏（靠设计，不靠承诺）

- **仅接受 Mock 资产**：金库构造函数强制 ERC-20 符号以 `m` 开头（如 `mUSDC`），从架构上无法接入真实稳定币。
- **链白名单**：部署脚本与 UI 都只允许 Hardhat 本地（31337）和 Sepolia（11155111），拒绝一切主网。
- **有界 Oracle**：NAV 单次更新上限 ±5%，且最短 15 分钟一次。
- **熔断器**：守护者可随时触发 —— NAV 强制回到 1.0，储户通过 `emergencyWithdraw` 按 1:1 本金退出。
- **费用上限**：绩效费 ≤ 20%，且只对超过历史高水位的利润部分计提。
- **纯模拟账本**：模拟器只做多、只写本地 JSON 文件，不含任何券商或交易所对接代码。

### 许可与免责

MIT © 2026 [JasonJr](./LICENSE)。本项目仅用于学习与研究 —— 所有输出为描述性研究信号，**不构成投资建议**，也不执行、不可能执行任何真实交易。完整条款见 [DISCLAIMER.md](./DISCLAIMER.md)。
