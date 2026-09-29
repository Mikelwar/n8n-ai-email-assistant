#!/usr/bin/env node
// Builds workflows/ai-email-assistant.json from the source files in this repo:
//   code/*.js         -> Code node bodies
//   prompts/*.md      -> system prompts in the "Config" node
//   test-data/sample-emails.json -> the demo emails
//
// You only need this if you edit those source files. Usage:
//   node scripts/build-workflow.js            (writes the file)
//   node scripts/build-workflow.js --stdout   (prints it instead)
// No local Node.js? See docs/SETUP.md ("Rebuilding the workflow JSON").

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const code = (file) => read(`code/${file}`).trim() + '\n';

// Deterministic IDs so rebuilding produces a clean git diff.
function idFor(name) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const ch of name) {
    h1 = Math.imul(h1 ^ ch.charCodeAt(0), 16777619) >>> 0;
    h2 = Math.imul(h2 ^ ch.charCodeAt(0), 2246822519) >>> 0;
  }
  const hex = (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).repeat(2);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const nodes = [];
function add(name, type, typeVersion, position, parameters, extra = {}) {
  nodes.push({ parameters, id: idFor(name), name, type, typeVersion, position, ...extra });
}
function sticky(key, position, width, height, color, content) {
  add(`Note · ${key}`, 'n8n-nodes-base.stickyNote', 1, position, { content, height, width, color });
}
function assignment(name, value, type = 'string') {
  return { id: idFor(`config.${name}`), name: `config.${name}`, value, type };
}

// --- Sticky notes -----------------------------------------------------------

sticky('Overview', [-600, -160], 520, 860, 7, `## AI Email Assistant
Classifies, summarizes, prioritizes and drafts replies for incoming email with Claude.

**Flow**
1. Receive email (demo, webhook or Gmail)
2. Normalize it to one schema
3. Claude: category, summary, priority (schema-validated JSON)
4. Business rules adjust priority (VIP senders, spam cap)
5. Claude: reply draft (skipped when no reply is needed)
6. Flat JSON record → webhook response + log

**Setup**
1. Create a **Header Auth** credential. Name: \`x-api-key\`. Value: your Anthropic API key.
2. Select it in both **Claude ·** nodes.
3. Adjust company details, VIP domains and prompts in **Config**.
4. Click **Execute workflow** to run the demo.

Secrets live only in n8n credentials, never in this workflow.`);

sticky('Demo mode', [-40, -160], 440, 500, 5, `### ① Demo / test mode
**Run Demo** loads 6 sample emails: one per category, plus a prompt-injection attempt.

**Webhook** accepts \`POST .../email-assistant\` with one email, an array, or \`{ "emails": [...] }\` and returns the results as JSON.`);

sticky('Production mode', [-40, 400], 440, 300, 3, `### ② Production mode (Gmail)
Disabled by default. Add a Gmail OAuth2 credential, enable this node, then publish the workflow. It polls for unread mail every minute.`);

sticky('Analysis', [440, 40], 1480, 540, 4, `### ③ AI analysis
One Claude call returns category, confidence, summary, priority score and a reply flag as schema-validated JSON. **Parse & Score** applies business rules and never drops an email: failures become \`status: needs_review\`.`);

sticky('Reply', [2000, -100], 860, 780, 6, `### ④ Reply drafting
Only emails that need a reply go to Claude a second time. Drafts use [placeholders] instead of inventing prices or dates, and are never sent automatically.`);

sticky('Output', [2880, -140], 680, 680, 2, `### ⑤ Output & logging
**Build Final Record** emits one flat JSON row per email.

Logging nodes are disabled until you connect a target. Enable **n8n Data Table** or **Google Sheets**, or swap in Notion / HubSpot. The same record fits all of them.`);

sticky('Mock AI', [440, 620], 560, 200, 5, `### 🧪 Demo mode (no API cost)
Demo mode runs without external AI API usage. Set \`demo_mode = false\` for production.

\`demo_mode\` is the first field in **Config**. When it is true, **DEMO · Mock Analyze** and **DEMO · Mock Draft Reply** replace the two Claude calls with local logic.`);

// --- Triggers -----------------------------------------------------------------

add('Run Demo', 'n8n-nodes-base.manualTrigger', 1, [0, 0], {});

const samples = JSON.parse(read('test-data/sample-emails.json'));
add('DEMO · Load Sample Emails', 'n8n-nodes-base.code', 2, [220, 0], {
  jsCode: `// Demo mode: six realistic test emails (one per category, plus a
// prompt-injection attempt) so the workflow runs without Gmail.
// Generated from test-data/sample-emails.json.

const SAMPLE_EMAILS = ${JSON.stringify(samples, null, 2)};

return SAMPLE_EMAILS.map((email) => ({ json: { ...email, source: 'demo' } }));
`,
});

add('Webhook · Receive Email', 'n8n-nodes-base.webhook', 2, [220, 200], {
  httpMethod: 'POST',
  path: 'email-assistant',
  responseMode: 'responseNode',
  options: {},
}, { webhookId: idFor('webhook-email-assistant') });

add('PROD · Gmail Trigger', 'n8n-nodes-base.gmailTrigger', 1.2, [220, 560], {
  pollTimes: { item: [{ mode: 'everyMinute' }] },
  simple: false,
  filters: { readStatus: 'unread' },
  options: {},
}, { disabled: true });

// --- Normalize + config -------------------------------------------------------------

add('Normalize Email', 'n8n-nodes-base.code', 2, [480, 200], { jsCode: code('normalize-email.js') });

add('Config', 'n8n-nodes-base.set', 3.4, [700, 200], {
  assignments: {
    assignments: [
      assignment('demo_mode', true, 'boolean'),
      assignment('model', 'claude-opus-5'),
      assignment('analysis_effort', 'low'),
      assignment('reply_effort', 'medium'),
      assignment('analysis_max_tokens', 4000, 'number'),
      assignment('reply_max_tokens', 6000, 'number'),
      assignment('max_body_chars', 20000, 'number'),
      assignment('use_refusal_fallback', true, 'boolean'),
      assignment('company_name', 'Northwind Analytics'),
      assignment('company_context', 'B2B SaaS company selling a self-serve data analytics and dashboard platform. Support hours are Monday to Friday, 09:00-18:00 CET.'),
      assignment('signature', 'Alex Morgan\nCustomer Success, Northwind Analytics'),
      assignment('vip_domains', 'bigclient.example'),
      assignment('analysis_system_prompt', read('prompts/analysis-system.md').trim()),
      assignment('reply_system_prompt', read('prompts/reply-system.md').trim()),
    ],
  },
  includeOtherFields: true,
  options: {},
});

// --- AI analysis ------------------------------------------------------------------

const claudeRequest = {
  method: 'POST',
  url: 'https://api.anthropic.com/v1/messages',
  authentication: 'genericCredentialType',
  genericAuthType: 'httpHeaderAuth',
  sendHeaders: true,
  specifyHeaders: 'json',
  jsonHeaders: '={{ JSON.stringify($json.anthropic_headers) }}',
  sendBody: true,
  specifyBody: 'json',
  jsonBody: '={{ JSON.stringify($json.anthropic_request) }}',
  options: { timeout: 180000 },
};
// Retry transient failures (429/5xx); a final failure is passed on as an item
// with an `error` field so the Code node can mark it needs_review.
const resilient = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, onError: 'continueRegularOutput' };

// IF node on a boolean expression; output 0 = true, output 1 = false.
function booleanIf(name, position, expression) {
  add(name, 'n8n-nodes-base.if', 2.2, position, {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          id: idFor(`${name}-condition`),
          leftValue: expression,
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        },
      ],
      combinator: 'and',
    },
    options: {},
  });
}

add('Build Analysis Request', 'n8n-nodes-base.code', 2, [920, 200], {
  mode: 'runOnceForEachItem',
  jsCode: code('build-analysis-request.js'),
});
booleanIf('Demo Mode? (Analyze)', [1140, 200], '={{ $json.config.demo_mode }}');
add('Claude · Analyze Email', 'n8n-nodes-base.httpRequest', 4.2, [1360, 200], claudeRequest, resilient);
add('DEMO · Mock Analyze', 'n8n-nodes-base.code', 2, [1360, 440], {
  mode: 'runOnceForEachItem',
  jsCode: code('mock-analyze.js'),
});
add('Parse & Score Analysis', 'n8n-nodes-base.code', 2, [1580, 200], {
  mode: 'runOnceForEachItem',
  jsCode: code('parse-and-score.js'),
});

add('Needs Reply?', 'n8n-nodes-base.if', 2.2, [1800, 200], {
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [
      {
        id: idFor('needs-reply-condition'),
        leftValue: '={{ $json.requires_reply }}',
        rightValue: '',
        operator: { type: 'boolean', operation: 'true', singleValue: true },
      },
    ],
    combinator: 'and',
  },
  options: {},
});

// --- Reply drafting -----------------------------------------------------------------

add('Build Reply Request', 'n8n-nodes-base.code', 2, [2060, 80], {
  mode: 'runOnceForEachItem',
  jsCode: code('build-reply-request.js'),
});
booleanIf('Demo Mode? (Reply)', [2280, 80], '={{ $json.config.demo_mode }}');
add('Claude · Draft Reply', 'n8n-nodes-base.httpRequest', 4.2, [2500, 80], claudeRequest, resilient);
add('DEMO · Mock Draft Reply', 'n8n-nodes-base.code', 2, [2500, 300], {
  mode: 'runOnceForEachItem',
  jsCode: code('mock-draft-reply.js'),
});
add('Attach Reply', 'n8n-nodes-base.code', 2, [2720, 80], {
  mode: 'runOnceForEachItem',
  jsCode: code('attach-reply.js'),
});
add('No Reply Needed', 'n8n-nodes-base.noOp', 1, [2500, 520], {});

// --- Output & logging ---------------------------------------------------------------

add('Merge Results', 'n8n-nodes-base.merge', 3.2, [2940, 200], { mode: 'append' });
add('Build Final Record', 'n8n-nodes-base.code', 2, [3160, 200], {
  mode: 'runOnceForEachItem',
  jsCode: code('build-final-record.js'),
});
add('Respond to Webhook', 'n8n-nodes-base.respondToWebhook', 1.4, [3420, 20], {
  respondWith: 'allIncomingItems',
  options: {},
});
add('Log · n8n Data Table', 'n8n-nodes-base.dataTable', 1, [3420, 200], {
  resource: 'row',
  operation: 'insert',
  dataTableId: { __rl: true, mode: 'list', value: '' },
  columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] },
  options: {},
}, { disabled: true });
add('Log · Google Sheets', 'n8n-nodes-base.googleSheets', 4.5, [3420, 380], {
  operation: 'append',
  documentId: { __rl: true, mode: 'list', value: '' },
  sheetName: { __rl: true, mode: 'list', value: '' },
  columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] },
  options: {},
}, { disabled: true });

// --- Connections ---------------------------------------------------------------------

const connections = {};
function connect(from, to, output = 0, input = 0) {
  const outputs = (connections[from] ??= { main: [] }).main;
  while (outputs.length <= output) outputs.push([]);
  outputs[output].push({ node: to, type: 'main', index: input });
}

connect('Run Demo', 'DEMO · Load Sample Emails');
connect('DEMO · Load Sample Emails', 'Normalize Email');
connect('Webhook · Receive Email', 'Normalize Email');
connect('PROD · Gmail Trigger', 'Normalize Email');
connect('Normalize Email', 'Config');
connect('Config', 'Build Analysis Request');
connect('Build Analysis Request', 'Demo Mode? (Analyze)');
connect('Demo Mode? (Analyze)', 'DEMO · Mock Analyze', 0);
connect('Demo Mode? (Analyze)', 'Claude · Analyze Email', 1);
connect('DEMO · Mock Analyze', 'Parse & Score Analysis');
connect('Claude · Analyze Email', 'Parse & Score Analysis');
connect('Parse & Score Analysis', 'Needs Reply?');
connect('Needs Reply?', 'Build Reply Request', 0);
connect('Needs Reply?', 'No Reply Needed', 1);
connect('Build Reply Request', 'Demo Mode? (Reply)');
connect('Demo Mode? (Reply)', 'DEMO · Mock Draft Reply', 0);
connect('Demo Mode? (Reply)', 'Claude · Draft Reply', 1);
connect('DEMO · Mock Draft Reply', 'Attach Reply');
connect('Claude · Draft Reply', 'Attach Reply');
connect('Attach Reply', 'Merge Results', 0, 0);
connect('No Reply Needed', 'Merge Results', 0, 1);
connect('Merge Results', 'Build Final Record');
connect('Build Final Record', 'Respond to Webhook');
connect('Build Final Record', 'Log · n8n Data Table');
connect('Build Final Record', 'Log · Google Sheets');

const workflow = {
  name: 'AI Email Assistant',
  nodes,
  connections,
  pinData: {},
  settings: { executionOrder: 'v1' },
  meta: { templateCredsSetupCompleted: false },
};

const json = JSON.stringify(workflow, null, 2) + '\n';
if (process.argv.includes('--stdout')) {
  process.stdout.write(json);
} else {
  const out = path.join(root, 'workflows', 'ai-email-assistant.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, json, 'utf8');
  console.log(`Wrote ${path.relative(root, out)} (${nodes.length} nodes)`);
}
