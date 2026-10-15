# Santi-Core

A single-page crypto workspace: market-cap leaders, a combined News / Tokenomics feed, a floating research panel, and an ElevenLabs Bull/Bear analysis and audio dialog.

The selected asset defaults to Bitcoin with a one-minute chart. Below Overviews,
the desktop workspace places the chart beside a compact latest-news column.
More opens `#news`, a separate view of the complete loaded feed with search,
News / Tokenomics filters and pagination. Smaller screens stack chart and news.
News asset badges use explicit headline/topic mentions or structured tokenomics
symbols, with CoinGecko logos where available. Multiple mentioned assets get
multiple badges; other stories show Market / Other. Assets outside the loaded
market use their structured ticker with a fallback mark when a logo is unavailable.

## Run locally

Use Node.js 24 and pnpm. In this directory:

```sh
pnpm --ignore-workspace install --frozen-lockfile
pnpm --ignore-workspace run dev
```

Open http://localhost:3000. `--ignore-workspace` isolates this downloaded project from the separate pnpm workspace in its parent directory.

## Data and refresh

- CoinGecko provides the top 10 assets, sorted by market capitalization in USD. The client refreshes every minute; provider timestamps are shown.
- CoinDesk, Cointelegraph, Decrypt and the official Tokenomist Research RSS provide publisher headlines, sorted by publication time. The client and shared feed cache refresh every minute. New items enter Latest News and the full News page automatically, without a page reload. Tokenomist Research headlines are labelled Tokenomics and retain their original publication dates and links.
- Refreshes run automatically while the page and local server are running. Requests do not overlap; failed requests keep existing data and retry on the next cycle. Coming back to an overdue tab or reconnecting to the internet triggers a check immediately. Browsers may delay timers in background/suspended tabs. The UI distinguishes the last successful check from the provider's data timestamp; it does not imply tick-by-tick streaming. Closing the website stops client refreshes.
- Tokenomics combines CoinGecko supply snapshots, related reporting and up to 25 upcoming cliff unlocks from Tokenomist when configured. Schedule update dates and future unlock dates are shown separately. Tokenomist is cached for one hour across all feed/research refreshes, with a five-minute retry delay on failure; plan coverage can limit the returned dataset.
- The public Tokenomist Research RSS (`https://insights.unlocks.app/rss/`) does not use the authenticated unlock API quota. It covers published research articles, not every entry in the interactive Tokenomist Updates dashboard. Polling more often does not change the publisher's publication schedule. The unlock API cache is independent of the one-minute RSS polling.
- Server requests have timeouts, shared in-flight requests and short caches. Failed refreshes preserve available data with a stale label; unavailable sources are identified. No fabricated fallback prices or articles are used.
- Research runs a source scan against these datasets and provides inspectable links. It does not call an LLM, read full articles, or generate financial predictions. Questions remain in browser memory.
- The analysis dialog narrates completed Bull/Bear reports through ElevenLabs. Two different voices take turns presenting claims and the opponent's actual replies; the transcript retains source links.

The API runs in Vite locally and in the shared `api/workspace.ts` Node.js function on Vercel. `vercel.json` routes `/api/*` to that function. Static-file-only hosting cannot serve the API. To check a production build locally, run `pnpm --ignore-workspace run build`, then `pnpm --ignore-workspace run preview` after stopping the development server.

## Tokenomist credentials

The server-only API credential belongs in `.local.env` as `TOKENOMIST_API_KEY=...`.
This exact filename is explicitly ignored and denied by the development file server.
`server/local-env.ts` reads it without exposing it through `import.meta.env`.
An empty value disables Tokenomist. The server sends the key only to
`https://api.tokenomist.ai` in the `x-api-key` header, with redirects disabled.
`/api/tokenomist/status` reports configuration and the last connection state without
returning credentials or account quota details. A valid key and sufficient plan
credits are required. Never use a `VITE_` prefix for the key.

## Bear / Bull analysis with ElevenLabs Agents

**Analysis by Bear/Bull** opens the **Listen to both sides** modal over the current
market or news workspace. The modal shows a rotating Bull/Bear loading animation
only while analysis is checking or running, then displays the report and audio
player. Close, Escape and backdrop clicks dismiss it, cancel pending work and
return focus to the opener. The background stays mounted and cannot receive
input while the modal is open. Reduced-motion preferences disable animation.
Legacy `#analysis/<asset>` URLs open the same modal. Analysis is backed by two hosted,
authenticated ElevenLabs Agents. Both use `gemini-2.5-flash` by default, with
model cascading disabled. The server checks the actual hosted model, disabled
backup, empty first message, and text-only mode before each conversation.

Set these server-only values in `.local.env`:

```dotenv
ELEVENLABS_AGENTS_API_KEY=
ELEVENLABS_AGENTS_MODEL=gemini-2.5-flash
ELEVENLABS_BULL_AGENT_ID=
ELEVENLABS_BEAR_AGENT_ID=
```

The Agents key is separate from the voice/TTS key. It needs Agents access to
create/read agents and start authenticated conversations. After adding it, run
`node --experimental-strip-types scripts/setup-eleven-agents.mts` to create
**Santi-Core Bull** and **Santi-Core Bear** and save their IDs. Setup resumes
without duplicating saved IDs; existing agents with a different configuration
are not overwritten. Only Gemini model IDs are accepted by local configuration.
No client keys, signed conversation URLs, or account credentials are exposed.
The previous analysis provider and its local credentials have been removed.

Each explicit analysis starts at most four text-only conversations: independent
research openings, followed by one response to every opposing claim. Agents can
read up to three registered publisher URLs per research opening. The server
retrieves bounded public article excerpts (up to 8,000 characters each), sharing
reads and reporting unavailable content. It does not bypass paywalls or provide
a general web-search service. Research covers the current news/Tokenomist feed
and market snapshot; this limitation is shown with the report. Article access
can fail, in which case only the headline or structured event is available.

Agents submit structured reports through client tools handled on the local
server. Arbitrary URLs, unexpected tools, unverifiable citations, incomplete
replies, disconnected sessions, and partial results cannot become completed
reports. Source text and opponent statements are untrusted evidence. Every
opponent claim must receive exactly one reply. Provenance checks do not prove
a source or model interpretation is correct. Both roles use the same model;
agreement is not independent verification. No winner or price probability is
produced. Token counts are not displayed because the conversation transport
does not provide reliable token accounting here.

Progress streams over `/api/analysis` as NDJSON. Reports are cached locally for
five minutes with their original timestamp, scoped by credential fingerprint,
model, agent IDs and asset. Only one analysis runs at a time, with a 15-second
cooldown. There are no automatic paid retries or background AI polling.
Closing the dialog or pressing Stop closes pending sessions; work already
processed may still be charged by ElevenLabs. Each conversation has a two-minute
timeout. Conversation storage follows the ElevenLabs workspace settings.

The floating **Research** panel remains a local source scan with no AI calls.
These routes require the Vite development/preview server or equivalent deployed
server routes.

## ElevenLabs Bull / Bear voices

Set server-only values in `.local.env`:

```dotenv
ELEVENLABS_API_KEY=
ELEVENLABS_MODEL=eleven_v3
ELEVENLABS_BULL_VOICE_ID=
ELEVENLABS_BEAR_VOICE_ID=
```

Use an API key with text-to-speech generation and voice-read access. Hosted
ElevenLabs Agents perform the source analysis and debate; ElevenLabs TTS voice
profiles narrate their completed reports. No voice cloning is performed. Empty voice IDs select two available account voices; the player
also lets the user pick two voices and preview them with fixed short English scripts.
The key stays on the server, sent only to `https://api.elevenlabs.io` via
`xi-api-key`, with redirects disabled. Configuration is read on each request.

Audio is generated only after pressing play or a voice-preview button. Play
continues through the report one clip at a time; pause, stop and next are available.
Only finished, server-registered reports can become speech; clients cannot send
arbitrary text. Every claim, caveat and opposing response is included, split into
at most 1,000 Unicode code points per clip. No additional LLM rewrite is used.
The transcript displays evidence links; URLs are not read aloud. Sources and AI
interpretations can still be wrong. Wave animations reflect HTML audio playback,
not the research process or the audio's measured amplitude.

The player shows total script characters. Generation uses ElevenLabs credits;
there is no background TTS polling, automatic retry or pre-generation. Leaving
the player or pressing stop aborts pending generation, though work already
processed by ElevenLabs may still be charged. Speech requests time out after
90 seconds. One generation is allowed at a time; other requests receive a retry
message. Same-origin JSON guards block cross-site spending from a browser.

Voice lists are cached for ten minutes. Reports carry a server-signed transcript valid for one hour, so audio requests work across Vercel instances and cold starts. The signature uses the server TTS credential with domain separation; rotating that credential invalidates old transcripts. Clients cannot change signed text. The browser sends the transcript in POST bodies, never in URLs. In-memory caches hold ten reports and forty clips / 48 MB per instance; a restart clears cached clips. Replaying a clip still in cache avoids a new generation request;
expired or evicted audio is generated again when requested. The dialog keeps
its report while open; reopening uses the five-minute server analysis cache when available. Create an analysis before using
full playback; voice previews work independently after adding the ElevenLabs key.

Routes: `GET /api/audio/config`, `GET /api/audio/reports/:reportId`,
`POST /api/audio/speech` and `POST /api/audio/preview`. Both the development
and preview server register these routes; static hosting alone cannot serve them.

## Checks

```sh
pnpm --ignore-workspace exec tsc --noEmit
pnpm --ignore-workspace run build
node --experimental-strip-types --test server/*.test.ts src/*.test.ts
```

The interface, impact explanations, agent reports and audio narration use English.
Thai asset aliases are retained only for matching user searches.


## Deploy to Vercel

Import this GitHub repository into Vercel using the Vite preset, Node.js 24,
`pnpm build`, and output directory `dist`. The shared API function allows up to
300 seconds for streamed analysis. Set all names from `.local.env.example` in
the project's production and preview Environment Variables. Store API keys as
secrets; never prefix credentials with `VITE_`, commit `.local.env`, or paste
credentials into source. The local file is optional on Vercel: process environment
values take precedence. No OpenAI credentials are needed.

The application is public, including Bear/Bull analysis and voice generation.
Analysis and audio consume the configured ElevenLabs account's credits.
Concurrency limits, the five-minute analysis cache, hourly unlock cache and clip
caches are per running instance, not global quotas. Cold starts or scaling can
cause additional provider requests. News RSS polling is independent of the
Tokenomist authenticated unlock API. No scheduled background worker is installed;
open clients request updates each minute. Vercel CDN caches successful public
market/feed responses for up to 60 seconds; paid analysis and audio are not
publicly cached. `POST /api/audio/manifest` verifies the signed transcript.

To validate a deployment, check market/feed responses, analysis configuration,
then run one analysis and play a segment. Never put provider keys in a browser
request. GitHub pushes to the connected production branch deploy automatically.
