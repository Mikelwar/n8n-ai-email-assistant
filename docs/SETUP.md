# Setup

This guide assumes the project's n8n instance is running at **http://localhost:5679** (n8n 2.x). This instance is separate from any other n8n instance on your machine. Nothing here touches other containers, volumes or workflows.

## 1. Import the workflow

1. Open `http://localhost:5679` and sign in.
2. Click **Create workflow**.
3. Open the **⋯** menu (top right), choose **Import from File…**, and select `workflows/ai-email-assistant.json`.
   *Alternative:* open the JSON file in an editor, copy everything, and paste it onto the empty canvas with `Ctrl+V`.
4. Save. The workflow is named **AI Email Assistant**.

Importing always creates a new workflow. It does not replace existing ones.

## 2. Add the Anthropic API key (production AI only)

> **Skip this step for a demo.** The workflow ships with `demo_mode = true`, so the **DEMO · Mock** nodes stand in for Claude and no key is needed. Come back here when you want real AI output.

The key is stored encrypted in n8n. It never appears in the workflow JSON or in any file in this repo.

1. Get an API key from the Anthropic Console (`console.anthropic.com` → API Keys).
2. In n8n: **Overview → Credentials → Create credential → Header Auth**.
3. Fill in:
   - **Name:** `x-api-key`
   - **Value:** your API key
   - Credential name (top of the dialog): `Anthropic API Key`
4. Open **Claude · Analyze Email**. **Authentication** is already set to *Generic Credential Type → Header Auth*, so just pick `Anthropic API Key` in the credential dropdown.
5. Do the same in **Claude · Draft Reply**, then save.
6. Open **Config** and set `demo_mode` to `false` (the first field).

## 3. Run the demo

`demo_mode` in **Config** decides who analyzes the emails:

| `demo_mode` | Path taken | Cost |
|---|---|---|
| `true` (default) | Demo Mode? → **DEMO · Mock Analyze** / **DEMO · Mock Draft Reply** | No API usage. Records show `model: "demo-mock"` |
| `false` | Demo Mode? → **Claude · Analyze Email** / **Claude · Draft Reply** | Anthropic API usage |

Demo mode applies to every trigger, including the webhook. The mocks use keyword rules and reply templates, so they show how the pipeline behaves, not how good the AI is. Use `false` to judge real output quality.

1. Click **Execute workflow** (the **Run Demo** trigger).
2. Six sample emails from `test-data/sample-emails.json` run through the pipeline:

   | # | Sender | Expected category | What it demonstrates |
   |---|---|---|---|
   | 1 | dana.whitfield@bigclient.example | Urgent | Outage before a board meeting; VIP domain adds +1 priority |
   | 2 | marco.rossi@freshcart.example | Sales / Lead | Pricing + demo request with a renewal deadline |
   | 3 | priya.nair@lumenlabs.example | Support | Bug with a workaround, so not urgent |
   | 4 | j.becker@partnerco.example | Meeting / Scheduling | Three proposed time slots |
   | 5 | sam@analytics-meetup.example | General | Thank-you note, no reply needed |
   | 6 | winner-notice@prize-claims.example | Spam / Low Priority | Scam with an embedded prompt-injection attempt |

3. Click **Build Final Record** and switch the output to **Table** or **JSON** to see the results.

In demo mode the run takes about a second. With `demo_mode = false`, expect about 20 to 60 seconds, since each email makes one or two API calls.

## 4. Test with your own emails (Webhook mode)

1. Click **Execute workflow**. The Webhook test URL now listens for one request.
2. Send an email (from the project folder):

   **PowerShell**
   ```powershell
   Invoke-RestMethod -Method Post -Uri http://localhost:5679/webhook-test/email-assistant -ContentType 'application/json' -InFile .\test-data\webhook-single-email.json
   ```

   **Git Bash / macOS / Linux**
   ```bash
   curl -X POST http://localhost:5679/webhook-test/email-assistant -H "Content-Type: application/json" -d @test-data/webhook-single-email.json
   ```

3. The response is an array of final records, one per email.

Accepted payloads:

```jsonc
// one email
{ "from": "Jane Doe <jane@example.com>", "subject": "…", "body": "…", "timestamp": "2026-09-28T10:00:00Z" }
// several emails
[ { … }, { … } ]
{ "emails": [ { … }, { … } ] }   // see test-data/webhook-batch.json
```

Only `from` and `body` (or `subject`) really matter. Missing timestamps default to the processing time and are flagged in `notes`. Field aliases such as `sender`, `text`, `html`, `date` and `received_at` are also understood.

**Permanent URL:** publish the workflow (**Publish** button), then use `http://localhost:5679/webhook/email-assistant` without `-test`. It doesn't need a manual execution first.

> Before exposing n8n beyond localhost, set the Webhook node's **Authentication** to *Header Auth* with a secret of your own.

## 5. Connect Gmail (Production mode)

Production mode uses the same pipeline. Only the trigger changes.

1. **Google Cloud Console:** create a project, enable the **Gmail API**, configure the OAuth consent screen (External, add yourself as a test user), then create an **OAuth client ID** of type *Web application* with this redirect URI:
   `http://localhost:5679/rest/oauth2-credential/callback`
2. **n8n:** create a **Gmail OAuth2 API** credential with that client ID and secret, then click **Sign in with Google**.
3. Open **PROD · Gmail Trigger**, select the credential, and **enable** the node (right-click → *Activate*, or press `D`). Make sure `demo_mode` is `false` in **Config** and the Anthropic credential is set up (step 2).
4. Optional: in the trigger's **Filters**, narrow it down with a search such as `-category:promotions` or a label.
5. **Publish** the workflow. The trigger polls for unread mail every minute.

The demo trigger and webhook can stay in place; they only run when called. The trigger reads the full message format (`Simplify` off), so **Normalize Email** gets the complete body.

> Note: polling doesn't change the email's read state in Gmail. See the roadmap in the README for labelling or marking mail as processed.

## 6. Logging

Both log nodes are disabled until you choose a destination. The final record has these columns:

```
message_id, source, timestamp, sender, sender_name, subject, category, confidence, priority, priority_label, priority_reason, summary, requires_reply, suggested_reply, reply_status, status, notes, model, processed_at
```

**Option A: n8n Data Table (no external account)**

1. **Overview → Data tables → Create data table** named `email_triage_log`.
2. Add the columns above. Use type *Number* for `confidence` and `priority`, *Boolean* for `requires_reply`, and *String* for all others.
3. Open **Log · n8n Data Table**, select the table, and enable the node.

**Option B: Google Sheets**

1. Create a sheet and paste the column list above into row 1, one name per column. Tip: paste the line into A1, then use *Data → Split text to columns*.
2. Create a **Google Sheets OAuth2** credential. The Google Cloud project from step 5 works, but you also need to enable the Google Sheets API.
3. Open **Log · Google Sheets**, select the document and sheet, and enable the node.

**Notion, Airtable, CRM:** add the matching node after **Build Final Record** and map the fields. Everything is a flat string, number or boolean.

## 7. Tune

Everything is in the **Config** node: model, effort, token limits, company context, signature, VIP domains and both prompts. For lasting changes, edit `prompts/*.md` or `code/*.js` and rebuild (below) so the repo stays the source of truth.

---

## Rebuilding and testing without local Node.js

The scripts need only Node.js, with no npm packages. If Node isn't installed, run them in a temporary container from the n8n image you already have. It mounts only this folder and is removed afterwards.

**PowerShell** (from the project folder)
```powershell
docker run --rm -v "${PWD}:/work" -w /work --entrypoint node n8nio/n8n scripts/build-workflow.js
```
```powershell
docker run --rm -v "${PWD}:/work:ro" -w /work --entrypoint node n8nio/n8n scripts/test-pipeline.js
```

Replace `n8nio/n8n` with your local image name (e.g. `n8n-ffmpeg:2.37.10`) to avoid a download. With Node.js installed, run `npm run build` and `npm test` instead.

After rebuilding, re-import the JSON, or paste changed code into the matching Code node.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Every record has `status: needs_review` and `notes: analysis: API error: Credentials not found` | `demo_mode` is `false` but no credential is selected in the Claude nodes (step 2) |
| Records show `model: demo-mock` although you expected real AI | `demo_mode` is still `true` in **Config** |
| `401 … invalid x-api-key` in `notes` | The Header Auth **Name** must be exactly `x-api-key`, and the value must be the full key |
| `400` mentioning `fallbacks` or `anthropic-beta` | Your account or model doesn't support the refusal fallback. Set `use_refusal_fallback` to `false` in Config |
| `404 … model` | Model ID typo in Config → `model` |
| `response hit max_tokens` | Raise `analysis_max_tokens` / `reply_max_tokens` in Config |
| Webhook returns 404 | Test URL: click **Execute workflow** first. Production URL: publish the workflow |
| Gmail node greyed out | It's disabled by default. Enable it (step 5) |
