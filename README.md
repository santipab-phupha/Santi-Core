# Santi-Core

**A Multi-Agent Platform for Crypto News Research and Analysis.**

Presented by Team **สันติภาพ** at **U-Hackathon 2026**.

[Live website](https://santi-core.vercel.app/) · [GitHub repository](https://github.com/santipab-phupha/Santi-Core)

Santi-Core brings market prices, crypto news, tokenomics, source checks and AI research into one dark-themed workspace. Bitcoin is selected by default, with a one-minute TradingView chart.

## What you can do

- Switch between the original asset cards and a market-cap heatmap of the top 50 assets.
- Follow News and Tokenomics in one feed, with asset logos and original-source links.
- Watch the connected **News feed → Source check → Impact AI** status circles. Their activity reflects real requests and review progress.
- Read source-supported Positive / Negative / Inconclusive impact labels for the selected asset.
- Open **Report** for the positive and negative evidence columns; **Close** hides it.
- Press **Listen** to open an audio popup and hear the report through ElevenLabs. Closing it stops playback.
- Open **Bear/Bull** to see both agents research and respond to every opposing claim. Bull uses green frames; Bear uses red frames.
- Use **Download report** under All arguments to save a complete HTML report with claims, replies, caveats and source links. It opens in a browser, including offline, and can be printed using the browser's Print command.
- Ask follow-up questions in the floating **Research** chat.
- See an eight-second opening animation, with Skip intro and Escape support.

## 1. Install and start

### Requirements

- **Node.js 24.x**
- **pnpm 10.x** (`npm install --global pnpm@10` if it is not installed)
- Git, if cloning the repository

```sh
git clone https://github.com/santipab-phupha/Santi-Core.git
cd Santi-Core
pnpm --ignore-workspace install --frozen-lockfile
```

Create your local configuration from the example. On Windows PowerShell:

```powershell
Copy-Item .local.env.example .local.env
```

On macOS or Linux:

```sh
cp .local.env.example .local.env
```

Do this only when creating a new configuration; do not overwrite an existing file containing your keys. Open `.local.env` in your editor and fill in the services you want to enable. **Use this exact filename:** the server reads `.local.env`, not `.env.local`.

Start the app:

```sh
pnpm --ignore-workspace run dev
```

Open **http://localhost:3000**. The port is strict: if it is occupied, stop the other process or explicitly choose a different `PORT`.

The market and public RSS feed work without AI credentials. The AI and audio features need the configuration below. No OpenAI key, CoinGecko key, TradingView key, MongoDB account or Supabase account is required by the current implementation.

## 2. Connect ElevenLabs

There are **four hosted AI agents**: Bull, Bear, Impact Analyst and Research. The original-link reference checker is an HTTP/text worker, not another LLM agent. Audio uses ElevenLabs TTS, not an additional research agent.

### Add your keys

Put these values in `.local.env`:

```dotenv
ELEVENLABS_AGENTS_API_KEY=your_agents_key
ELEVENLABS_AGENTS_MODEL=gemini-2.5-flash
ELEVENLABS_API_KEY=your_tts_key
ELEVENLABS_MODEL=eleven_v3
```

The Agents key needs access to read/create agents and start authenticated conversations. The TTS key needs voice-read and text-to-speech access. These are separate settings, even if your account permits one key to serve both purposes. Never put credentials in source files or names beginning with `VITE_`.

### Create or connect the agents

After saving the Agents key, run these commands from the project directory:

```sh
node --experimental-strip-types scripts/setup-eleven-agents.mts
node --experimental-strip-types scripts/setup-local-impact-analyst.mts
node --experimental-strip-types scripts/setup-local-research-agent.mts
```

The scripts create or reuse the named hosted agents and save their IDs into `.local.env`. Bull/Bear setup resumes from saved IDs. The dedicated analyst and Research scripts retain “local” in their filenames and agent names; the saved hosted IDs can also be configured on Vercel. They do not deploy the website or change Vercel settings for you.

If you already have compatible agents, enter all four IDs directly instead:

```dotenv
ELEVENLABS_BULL_AGENT_ID=agent_...
ELEVENLABS_BEAR_AGENT_ID=agent_...
ELEVENLABS_IMPACT_AGENT_ID=agent_...
ELEVENLABS_RESEARCH_AGENT_ID=agent_...
```

Hosted settings must match the application: authenticated English text-only Gemini agents, empty first messages, disabled backup models and the expected submission tools. The Impact Analyst's thinking budget must match `IMPACT_ANALYSIS_THINKING_BUDGET` (default 1024). Changing an environment value alone does not update the hosted agent.

The dedicated setup scripts accept `--update-local` to update only their corresponding named agent. If you reuse that hosted ID in production, changing it also affects production conversations. Bull/Bear setup does not silently overwrite incompatible existing agents.

Optional voice IDs:

```dotenv
ELEVENLABS_BULL_VOICE_ID=
ELEVENLABS_BEAR_VOICE_ID=
```

Empty values choose available account voices. Bull/Bear narration requires two distinct voices; report narration uses the default Bull voice. Listen starts report audio immediately after preparation; the debate player generates audio only when Play or Preview is pressed. A browser that blocks playback shows a Play button.

## 3. Connect Tokenomist (optional)

```dotenv
TOKENOMIST_API_KEY=your_tokenomist_key
```

This enables authenticated upcoming cliff-unlock data, subject to your plan. Without a key, public news and Tokenomist Research RSS still work. The RSS feed is `https://insights.unlocks.app/rss/`; it is not the full interactive Tokenomist Updates dashboard and uses no authenticated unlock-API quota.

The unlock API is cached for one hour, separately from one-minute news refreshes. `/api/tokenomist/status` shows configuration and connection status without revealing the key.

## 4. Environment variable reference

All variables below are **server-only**. On Vercel, process environment variables take precedence over the local file.

| Variable | Needed for | Default / notes |
| --- | --- | --- |
| `ELEVENLABS_AGENTS_API_KEY` | All AI features | Required for agent conversations |
| `ELEVENLABS_AGENTS_MODEL` | All AI features | `gemini-2.5-flash`; must match hosted agents |
| `ELEVENLABS_BULL_AGENT_ID` | Bear/Bull | Hosted Bull agent ID |
| `ELEVENLABS_BEAR_AGENT_ID` | Bear/Bull | Hosted Bear agent ID |
| `ELEVENLABS_IMPACT_AGENT_ID` | Automatic impact review | Dedicated impact-only analyst ID |
| `ELEVENLABS_RESEARCH_AGENT_ID` | Research chat | Dedicated Research agent ID |
| `ELEVENLABS_API_KEY` | Report and debate audio | TTS generation and voice-read access |
| `ELEVENLABS_MODEL` | Audio | `eleven_v3` |
| `ELEVENLABS_BULL_VOICE_ID` | Audio | Optional account voice ID |
| `ELEVENLABS_BEAR_VOICE_ID` | Debate audio | Optional distinct account voice ID |
| `TOKENOMIST_API_KEY` | Upcoming unlocks | Optional; RSS is independent |
| `IMPACT_REVIEW_CONCURRENCY` | Impact workers | `3`; range 1–3 per process |
| `IMPACT_REVIEW_BATCH_SIZE` | News items per impact task | `4`; range 1–8 |
| `IMPACT_ANALYSIS_THINKING_BUDGET` | Impact reasoning | `1024`; range 128–8192; match hosted settings |
| `REFERENCE_CHECK_CONCURRENCY` | Original-link checks | `6`; range 1–12 |
| `REFERENCE_CHECK_TIMEOUT_MS` | Original-link checks | `6000`; range 1000–10000 ms |
| `LOCAL_SOURCE_REVIEW_ENABLED` | Local full-feed source queue | `false`; opt in with `true`; always disabled on Vercel |

No additional key is needed for the current CoinGecko public endpoint, the TradingView embed or the publisher RSS feeds. Provider availability and public rate limits still apply.

## 5. Deploy to Vercel

1. Push the complete application to GitHub, including `server/`, `api/`, `scripts/` and the lockfile. Do not upload only `dist/`.
2. Import the repository into the intended Vercel team and project. For this repository, the existing project is **santi-core**.
3. Use these build settings:

   | Setting | Value |
   | --- | --- |
   | Framework | Vite |
   | Node.js | 24.x |
   | Install | `pnpm install --frozen-lockfile` |
   | Build | `pnpm build` |
   | Output | `dist` |

4. In **Project → Settings → Environment Variables**, add the keys and all four Agent IDs from the table above. Select **Production** for the live website and **Preview** if preview deployments should use those services too. Store API keys as secrets. Never upload `.local.env`.
5. Deploy or redeploy **after saving the variables**. Changes apply to new deployments, not an already running build. With the Git integration, pushes to the configured production branch deploy automatically.
6. Check the routes and user flows below before considering the deployment verified.

`vercel.json` rewrites `/api/*` to the shared Node.js function `api/workspace.ts`, with cancellation support and a 300-second maximum duration. Static-only hosting cannot run the API. Keep TypeScript's `rewriteRelativeImportExtensions` enabled so compiled server imports resolve correctly.

### What behaves differently in production

- The optional full-feed source-check loop runs only in the local Vite server. Setting `LOCAL_SOURCE_REVIEW_ENABLED=true` on Vercel does **not** create a scheduled worker. Production checks sources on demand through the research/review flows.
- Open clients request market/news updates every minute. Vercel CDN caching and per-instance server caching can reuse responses; this is not a centrally scheduled ingestion service.
- Impact/source results use Vercel Runtime Cache, scoped by region/environment. No database environment variables need to be added for this cache. It is ephemeral and does not provide a transactional global lock.
- Debate, Research conversation and audio-clip caches are per instance. Cold starts, scaling and expiration can cause fresh provider requests. They are not account-wide spending limits.

## 6. Verify the installation or deployment

Run the local checks:

```sh
pnpm --ignore-workspace run typecheck
pnpm --ignore-workspace run test
pnpm --ignore-workspace run build
pnpm --ignore-workspace run check:server
```

`check:server` compiles and starts the emitted JavaScript API to catch deployment import problems that Vite's development loader can hide.

Useful read-only checks (replace the host with localhost or your deployment):

| Route | Expected result |
| --- | --- |
| `/api/market` | JSON with real assets and freshness information |
| `/api/feed` | JSON with publisher items and any unavailable sources |
| `/api/tokenomist/status` | Configuration / last connection state, never the key |
| `/api/analysis/config` | `configured: true` when Bull/Bear settings exist |
| `/api/research/config` | `configured: true` when Research settings exist |
| `/api/audio/config` | Available account voices and audio configuration |
| `/api/impact/news` | Cached source/impact states; no new model inference |
| `/api/impact/review?coinId=bitcoin` | Cached review labels; no new model inference |

Configuration checks alone do not prove that a provider accepts conversations. For end-to-end verification, load the page, select an asset, inspect the completed review and references, open Report, play a report segment, run Bear/Bull and ask one Research question. These actions may use ElevenLabs credits. Downloading a completed report does not run another analysis.

### Troubleshooting

| Symptom | What to check |
| --- | --- |
| Port 3000 is occupied | Keep one development server running, or explicitly set another `PORT` |
| AI is not configured | Check the Agents key and the Agent ID for the failing feature |
| Impact review rejects hosted settings | Confirm the dedicated impact-only agent, model, tools and thinking budget; do not reuse the old combined source/impact agent |
| Research chat is unavailable | Add `ELEVENLABS_RESEARCH_AGENT_ID`, then redeploy |
| Audio is unavailable | Check the separate TTS key, voice-read permission and available voices |
| Provider quota or 429 errors | Check the relevant provider plan/credits and retry explicitly; no automatic paid retry is performed |
| `/api/*` is missing after deployment | Deploy the full repository and preserve the rewrites in `vercel.json` |
| Server import error | Run `check:server`; preserve explicit server imports and TypeScript import-extension rewriting |
| Full-feed source checks do not run on Vercel | Expected: the persistent local loop is disabled there; production needs a separate scheduled ingestion design for that behavior |
| A story remains Pending | Not all loaded news is automatically analyzed for every asset; use its review action or wait until it enters the bounded asset review |

## Data, review and caching behavior

CoinGecko supplies the top 50 assets by market cap in USD. News comes from CoinDesk, Cointelegraph, Decrypt and Tokenomist Research RSS; optional Tokenomist API data adds up to 25 upcoming cliff unlocks. Provider timestamps and source links are retained. Missing data is not replaced with fabricated prices or headlines.

The source worker opens the original publisher link and matches readable headline/article text. A successful HTTP response alone is insufficient. Teal **Source checked** means text correspondence; green **Approved** additionally requires completed impact analysis. Unsupported stories remain visible as **No evidence / Inconclusive**. Text correspondence is not factual certification or independent corroboration.

Automatic impact review is bounded to the selected asset's eligible news and the latest preview items, using recent news within 72 hours and upcoming unlocks. It does not analyze every asset or the entire feed on a paid background schedule. Supported neutral context and supply snapshots stay outside the directional bar. The bar shows evidence shares, not price probabilities.

Successful source checks and directional/neutral impact labels are cached for six hours; unsupported or Inconclusive results for thirty minutes. Cache keys include the relevant source content and, for impact, asset/model/agent settings. Local results persist in `.cache/impact-reviews.json`. The optional local full-feed source queue uses HTTP only, even when no visitor is open.

Bear/Bull is a separate on-demand debate, normally four conversations, with a five-minute per-instance report cache. Research starts on explicit questions and carries bounded recent chat context. Report reads completed review results without repeating model inference. TTS clips are generated one at a time and cached per instance for up to one hour; signed report transcripts allow playback across instances. Identical clips may need regeneration after expiry, eviction or a cold start.

The public deployment lets visitors use AI and audio with the configured account's credits. The current concurrency controls and caches reduce repeated work but are not a durable global quota. Closing a task cancels pending work; provider work already processed may still be charged.

## Project layout

```text
src/       React interface, charts, reports, audio and status widgets
server/    Provider clients, validation, source checks, AI orchestration and caching
api/       Vercel function entry point
scripts/   Agent setup and compiled-server verification
public/    Brand SVGs and static assets
```

`.local.env`, `.env*`, caches, build output and dependencies are excluded from Git. Keep real API keys out of commits, screenshots, issue reports and client bundles.
