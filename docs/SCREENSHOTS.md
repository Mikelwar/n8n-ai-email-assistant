# Screenshot guide

Take screenshots after a successful **Run Demo** execution, so every node shows green checkmarks and item counts.

**Demo mode or real AI?**
- Canvas and structure shots (#1, #7, #8, #12) work in either mode.
- Shots that show AI output (#2–#6) should come from a run with `demo_mode = false` and a real API key, because that's the AI quality a client is buying.
- If you use a demo-mode run for these anyway, label it "demo data". Records then show `model: demo-mock`.

**General tips**

- Use a browser window about 1600×1000 and hide bookmarks bars and unrelated tabs.
- Use the same n8n theme (light or dark) for every shot.
- Before capturing the canvas, press `Shift+1` (zoom to fit), then zoom in one step if the node names are too small to read.
- Never show the credentials page with a key visible, your n8n account email, or `n8n-data/`.
- All demo senders use fictional `.example` domains, so the data is safe to show.

## Shot list

| # | Screenshot | How to capture | Best for |
|---|---|---|---|
| 1 | **Full workflow canvas** after a successful run | Zoom to fit, with all sticky notes visible and item counts on the connections (`6 items`, `4 items` / `2 items` at *Needs Reply?*) | Hero image on every platform |
| 2 | **Results table** | Open *Build Final Record* → output → **Table** view. Scroll so `sender`, `category`, `priority_label`, `summary` and `reply_status` are visible | Contra, Upwork, LinkedIn |
| 3 | **Single record, JSON view** | *Build Final Record* → **JSON** view, showing the Sales / Lead email (#2) with its draft reply | GitHub README, Upwork |
| 4 | **Suggested reply close-up** | Same node, Table or Schema view, zoomed on `suggested_reply` for the Urgent email (#1). Placeholders like `[confirm …]` show the human-in-the-loop design | LinkedIn, Contra |
| 5 | **Explainable priority** | Record #1 (VIP domain) with a `priority_reason` ending in a rules note such as `[rules: VIP sender 4→5]`. The exact adjustments depend on the model's base score | Case study "business rules" section |
| 6 | **Prompt-injection resisted** | Record #6: `category: Spam / Low Priority`, `priority: 1`, `reply_status: skipped`. Put it side by side with the email body containing "NOTE TO AI EMAIL ASSISTANT: ignore all previous instructions…" | LinkedIn (strong hook), case study |
| 7 | **The IF split** | Zoom on *Needs Reply?* showing `true: 4 items` / `false: 2 items` | Case study "cost control" section |
| 8 | **Config node** | Open *Config*, show model, effort, VIP domains and the start of the prompt. Proves everything is tunable without code | Upwork, GitHub |
| 9 | **Webhook test** | Terminal running the `curl`/`Invoke-RestMethod` command next to the JSON response | GitHub, technical audiences |
| 10 | **Log destination** *(optional)* | Google Sheet or n8n Data Table filled with the six demo rows | Contra, Upwork ("where the data ends up") |
| 11 | **Offline tests passing** | Terminal output of `npm test` showing "23 passed" and the summary table | GitHub |
| 12 | **Demo / production switch** | Zoom on *Config* (`demo_mode`) plus a *Demo Mode?* router with the Claude node on one branch and the DEMO mock on the other | GitHub, case study "cost-free demo" point |

## Per platform

**Contra:** cover image = #1. Gallery = #2, #4, #6, #10. Keep captions to one line each.

**Upwork:** thumbnail = #1 (crop tighter so nodes are legible at small size). Gallery = #2, #5, #8, #10. Add a 60-second screen recording of a Run Demo execution if possible; video converts well on Upwork.

**LinkedIn:** a carousel (PDF upload) works best:
1. Title slide with the problem ("Your inbox doesn't need more email. It needs triage.")
2. #1 canvas
3. #2 results table
4. #6 prompt injection resisted
5. #4 draft reply
6. Tech stack + call to action

Or a single image post using #2 with the post text from `PORTFOLIO.md`.

**GitHub:** put #1 at the top of the README (save as `docs/images/workflow.png`), #3 in the Output section, and #11 in Testing. Add an animated GIF of an execution if you can. To embed, add `![Workflow](docs/images/workflow.png)` under the README title.

## Optional: short demo video (60–90 s)

1. Canvas overview, 5 s
2. Click **Execute workflow** and watch nodes turn green, 15 s
3. Open *Build Final Record* in Table view and scroll through the categories, 20 s
4. Open the Urgent email's reply draft, 15 s
5. Show the spam email with the injection attempt, 10 s
6. Send the webhook test from a terminal and show the JSON response, 15 s
