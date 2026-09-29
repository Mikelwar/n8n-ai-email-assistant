#!/usr/bin/env node
// Offline test for the workflow logic. No n8n instance and no API key needed.
//
// - Validates workflows/ai-email-assistant.json (node wiring, embedded code
//   matches code/*.js, no credentials or secrets in the file)
// - Runs every Code node through the full pipeline with mocked Claude
//   responses, including failure paths (API error, refusal, bad JSON)
//
// Usage: node scripts/test-pipeline.js

const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
const workflow = JSON.parse(read('workflows/ai-email-assistant.json'));
const nodeByName = Object.fromEntries(workflow.nodes.map((n) => [n.name, n]));

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.log(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

// --- Minimal n8n Code node runtime ------------------------------------------------

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const jsCode = (nodeName) => nodeByName[nodeName].parameters.jsCode;

async function runForAll(nodeName, items) {
  const fn = new AsyncFunction('$input', jsCode(nodeName));
  return fn({ all: () => items.map((json) => ({ json })) });
}

async function runForEach(nodeName, json, refs = {}) {
  const $ = (name) => {
    if (!(name in refs)) throw new Error(`test did not provide $('${name}')`);
    return { item: { json: refs[name] } };
  };
  const fn = new AsyncFunction('$json', '$input', '$', jsCode(nodeName));
  const out = await fn(json, { item: { json } }, $);
  return out.json ?? out;
}

// Mimics the "Config" Set node: dot-notation fields become a nested object.
function applyConfig(email) {
  const config = {};
  for (const a of nodeByName.Config.parameters.assignments.assignments) {
    config[a.name.replace(/^config\./, '')] = a.value;
  }
  return { ...email, config };
}

// --- Mock Claude ---------------------------------------------------------------

function claudeResponse(payload, overrides = {}) {
  return {
    model: 'claude-opus-5',
    stop_reason: 'end_turn',
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) },
    ],
    ...overrides,
  };
}

function mockAnalyze(request) {
  const msg = request.messages[0].content.toLowerCase();
  const pick = (category, priority_score, requires_reply) =>
    claudeResponse({ category, confidence: 0.92, summary: `Mock summary for ${category}.`, priority_score, priority_reason: 'Mock reason.', requires_reply });
  if (msg.includes('gift card') || msg.includes('newsletter')) return pick('Spam / Low Priority', 3, false);
  if (msg.includes('not loading')) return pick('Urgent', 3, true);
  if (msg.includes('pricing')) return pick('Sales / Lead', 4, true);
  if (msg.includes('find a time') || msg.includes('finding a time') || msg.includes('move tomorrow')) return pick('Meeting / Scheduling', 3, true);
  if (msg.includes('thanks for speaking')) return pick('General', 1, false);
  return pick('Support', 3, true);
}

const mockReply = () => claudeResponse({ reply_body: 'Hi there,\n\nThanks for reaching out. [details]\n\nBest,\nAlex Morgan' });

// Runs one normalized email through the rest of the workflow. With
// demo: true the workflow's own DEMO · Mock nodes stand in for Claude,
// exactly as the "Demo Mode?" routers do in n8n.
async function runPipeline(email, { analyze = mockAnalyze, reply = mockReply, demo = false } = {}) {
  const configured = applyConfig(email);
  const analysisReq = await runForEach('Build Analysis Request', configured);
  const analysisRes = demo ? await runForEach('DEMO · Mock Analyze', analysisReq) : analyze(analysisReq.anthropic_request);
  const scored = await runForEach('Parse & Score Analysis', analysisRes, { 'Build Analysis Request': analysisReq });

  let merged = scored;
  if (scored.requires_reply) {
    const replyReq = await runForEach('Build Reply Request', scored);
    const replyRes = demo ? await runForEach('DEMO · Mock Draft Reply', replyReq) : reply(replyReq.anthropic_request);
    merged = await runForEach('Attach Reply', replyRes, { 'Build Reply Request': replyReq });
  }
  const record = await runForEach('Build Final Record', merged);
  return { analysisReq, scored, record };
}

const RECORD_FIELDS = [
  'message_id', 'source', 'timestamp', 'sender', 'sender_name', 'subject', 'category', 'confidence',
  'priority', 'priority_label', 'priority_reason', 'summary', 'requires_reply', 'suggested_reply',
  'reply_status', 'status', 'notes', 'model', 'processed_at',
];

// --- Tests -----------------------------------------------------------------------------

(async () => {
  console.log('\nWorkflow JSON');

  await test('every connection points at an existing node', () => {
    for (const [from, { main }] of Object.entries(workflow.connections)) {
      assert.ok(nodeByName[from], `unknown source ${from}`);
      for (const target of main.flat()) assert.ok(nodeByName[target.node], `unknown target ${target.node}`);
    }
  });

  await test('embedded Code node bodies match code/*.js', () => {
    const map = {
      'Normalize Email': 'normalize-email.js',
      'Build Analysis Request': 'build-analysis-request.js',
      'Parse & Score Analysis': 'parse-and-score.js',
      'Build Reply Request': 'build-reply-request.js',
      'Attach Reply': 'attach-reply.js',
      'Build Final Record': 'build-final-record.js',
      'DEMO · Mock Analyze': 'mock-analyze.js',
      'DEMO · Mock Draft Reply': 'mock-draft-reply.js',
    };
    for (const [node, file] of Object.entries(map)) {
      assert.equal(jsCode(node).trim(), read(`code/${file}`).trim(), `${node} is stale, rebuild the workflow`);
    }
  });

  await test('no credentials or API keys in the workflow file', () => {
    const raw = read('workflows/ai-email-assistant.json');
    assert.ok(!/sk-ant-[a-z0-9]/i.test(raw), 'found something that looks like an Anthropic key');
    for (const n of workflow.nodes) assert.equal(n.credentials, undefined, `${n.name} carries a credential reference`);
  });

  await test('production and logging nodes are disabled by default', () => {
    for (const name of ['PROD · Gmail Trigger', 'Log · n8n Data Table', 'Log · Google Sheets']) {
      assert.equal(nodeByName[name].disabled, true, `${name} should be disabled`);
    }
  });

  await test('demo_mode routers: true → DEMO mock, false → Claude, both rejoin downstream', () => {
    const targets = (from, output) => workflow.connections[from].main[output].map((c) => c.node);
    assert.deepEqual(targets('Build Analysis Request', 0), ['Demo Mode? (Analyze)']);
    assert.deepEqual(targets('Demo Mode? (Analyze)', 0), ['DEMO · Mock Analyze']);
    assert.deepEqual(targets('Demo Mode? (Analyze)', 1), ['Claude · Analyze Email']);
    assert.deepEqual(targets('DEMO · Mock Analyze', 0), ['Parse & Score Analysis']);
    assert.deepEqual(targets('Claude · Analyze Email', 0), ['Parse & Score Analysis']);
    assert.deepEqual(targets('Build Reply Request', 0), ['Demo Mode? (Reply)']);
    assert.deepEqual(targets('Demo Mode? (Reply)', 0), ['DEMO · Mock Draft Reply']);
    assert.deepEqual(targets('Demo Mode? (Reply)', 1), ['Claude · Draft Reply']);
    assert.deepEqual(targets('DEMO · Mock Draft Reply', 0), ['Attach Reply']);
    assert.deepEqual(targets('Claude · Draft Reply', 0), ['Attach Reply']);
    for (const name of ['Demo Mode? (Analyze)', 'Demo Mode? (Reply)']) {
      assert.equal(nodeByName[name].parameters.conditions.conditions[0].leftValue, '={{ $json.config.demo_mode }}');
    }
  });

  await test('Claude nodes still call the Anthropic API with the Header Auth credential', () => {
    for (const name of ['Claude · Analyze Email', 'Claude · Draft Reply']) {
      const n = nodeByName[name];
      assert.equal(n.type, 'n8n-nodes-base.httpRequest');
      assert.equal(n.parameters.url, 'https://api.anthropic.com/v1/messages');
      assert.equal(n.parameters.genericAuthType, 'httpHeaderAuth');
      assert.equal(n.onError, 'continueRegularOutput');
    }
  });

  console.log('\nNormalize Email');

  await test('demo items keep their source and parse "Name <email>"', async () => {
    const [out] = await runForAll('Normalize Email', [{ source: 'demo', from: 'Dana W <Dana@BigClient.example>', subject: 'Hi', body: 'x', timestamp: '2026-09-28T09:52:00Z' }]);
    assert.equal(out.json.source, 'demo');
    assert.equal(out.json.sender, 'dana@bigclient.example');
    assert.equal(out.json.sender_name, 'Dana W');
    assert.equal(out.json.timestamp, '2026-09-28T09:52:00.000Z');
  });

  await test('webhook batch { emails: [...] } fans out to one item per email', async () => {
    const batch = JSON.parse(read('test-data/webhook-batch.json'));
    const out = await runForAll('Normalize Email', [{ headers: {}, params: {}, query: {}, body: batch }]);
    assert.equal(out.length, 2);
    assert.ok(out.every((i) => i.json.source === 'webhook'));
    assert.equal(out[1].json.sender, 'newsletter@saas-weekly.example');
  });

  await test('Gmail full format (from.value, html only, Date)', async () => {
    const [out] = await runForAll('Normalize Email', [{
      id: '18f', threadId: '18f', subject: 'Re: contract',
      from: { value: [{ address: 'Kim@Firm.example', name: 'Kim Lee' }], text: 'Kim Lee <kim@firm.example>' },
      html: '<p>Hello&nbsp;there</p><p>Line two</p>', date: '2026-09-28T08:00:00.000Z',
    }]);
    assert.equal(out.json.source, 'gmail');
    assert.equal(out.json.sender, 'kim@firm.example');
    assert.equal(out.json.body, 'Hello there\nLine two');
    assert.equal(out.json.message_id, '18f');
  });

  await test('Gmail simplified format (From, Subject, snippet, internalDate)', async () => {
    const [out] = await runForAll('Normalize Email', [{
      id: 'a1', threadId: 'a1', From: '"Ops Bot" <ops@vendor.example>', Subject: 'Weekly report', snippet: 'Report attached', internalDate: '1790000000000',
    }]);
    assert.equal(out.json.sender, 'ops@vendor.example');
    assert.equal(out.json.subject, 'Weekly report');
    assert.equal(out.json.timestamp, new Date(1790000000000).toISOString());
  });

  await test('missing timestamp and subject get safe defaults and are flagged', async () => {
    const [out] = await runForAll('Normalize Email', [{ from: 'a@b.example', body: 'hello' }]);
    assert.equal(out.json.subject, '(no subject)');
    assert.equal(out.json.timestamp_inferred, true);
  });

  console.log('\nAnalysis request');

  const normalizedSamples = (await runForAll('Normalize Email', JSON.parse(read('test-data/sample-emails.json')).map((e) => ({ ...e, source: 'demo' })))).map((i) => i.json);

  await test('request uses structured outputs, effort and the refusal fallback', async () => {
    const req = await runForEach('Build Analysis Request', applyConfig(normalizedSamples[0]));
    const r = req.anthropic_request;
    assert.equal(r.model, 'claude-opus-5');
    assert.equal(r.output_config.format.type, 'json_schema');
    assert.equal(r.output_config.effort, 'low');
    assert.equal(r.fallbacks, 'default');
    assert.equal(req.anthropic_headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
    assert.ok(r.system.includes('email triage analyst'));
    assert.ok(r.messages[0].content.includes('<email>'));
    const schema = r.output_config.format.schema;
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
  });

  await test('long bodies are truncated and flagged, never silently', async () => {
    const req = await runForEach('Build Analysis Request', applyConfig({ ...normalizedSamples[0], body: 'x'.repeat(25000) }));
    assert.equal(req.body_truncated, true);
    assert.ok(req.anthropic_request.messages[0].content.includes('[... body truncated for analysis ...]'));
  });

  console.log('\nScoring rules and failure handling');

  await test('VIP sender + Urgent: floor to 4, then VIP bump to 5', async () => {
    const { record } = await runPipeline(normalizedSamples[0]);
    assert.equal(record.category, 'Urgent');
    assert.equal(record.priority, 5);
    assert.equal(record.priority_label, 'Critical');
    assert.match(record.priority_reason, /urgent floor 3→4, VIP sender 4→5/);
  });

  await test('spam is capped at priority 1 and gets no reply', async () => {
    const { record } = await runPipeline(normalizedSamples[5]);
    assert.equal(record.category, 'Spam / Low Priority');
    assert.equal(record.priority, 1);
    assert.equal(record.requires_reply, false);
    assert.equal(record.suggested_reply, '');
    assert.equal(record.reply_status, 'skipped');
  });

  await test('API error becomes needs_review instead of a failed run', async () => {
    const { record } = await runPipeline(normalizedSamples[1], { analyze: () => ({ error: { message: '401 - invalid x-api-key' } }) });
    assert.equal(record.status, 'needs_review');
    assert.match(record.notes, /invalid x-api-key/);
    assert.equal(record.priority, 3);
  });

  await test('refusal and invalid JSON are caught', async () => {
    const refusal = await runPipeline(normalizedSamples[1], { analyze: () => claudeResponse('', { stop_reason: 'refusal' }) });
    assert.match(refusal.record.notes, /refusal/);
    const badJson = await runPipeline(normalizedSamples[1], { analyze: () => claudeResponse('not json') });
    assert.match(badJson.record.notes, /not valid JSON/);
  });

  await test('unknown category from the model is rejected', async () => {
    const { record } = await runPipeline(normalizedSamples[1], {
      analyze: () => claudeResponse({ category: 'Billing', confidence: 1, summary: 's', priority_score: 3, priority_reason: 'r', requires_reply: true }),
    });
    assert.equal(record.status, 'needs_review');
  });

  await test('failed reply keeps the analysis and flags the record', async () => {
    const { record } = await runPipeline(normalizedSamples[1], { reply: () => ({ error: 'timeout' }) });
    assert.equal(record.category, 'Sales / Lead');
    assert.equal(record.reply_status, 'failed');
    assert.equal(record.status, 'needs_review');
  });

  console.log('\nDemo mode (DEMO · Mock nodes)');

  const demoRecords = [];
  for (const email of normalizedSamples) demoRecords.push((await runPipeline(email, { demo: true })).record);

  await test('mock analysis classifies all six sample emails as intended', () => {
    assert.deepEqual(demoRecords.map((r) => r.category), ['Urgent', 'Sales / Lead', 'Support', 'Meeting / Scheduling', 'General', 'Spam / Low Priority']);
    assert.deepEqual(demoRecords.map((r) => r.priority), [5, 4, 3, 3, 1, 1]);
    assert.ok(demoRecords.every((r) => r.status === 'ok' && r.model === 'demo-mock'));
  });

  await test('mock analysis handles the webhook test emails', async () => {
    const webhookEmails = await runForAll('Normalize Email', [
      { headers: {}, body: JSON.parse(read('test-data/webhook-single-email.json')) },
      { headers: {}, body: JSON.parse(read('test-data/webhook-batch.json')) },
    ]);
    const categories = [];
    for (const { json } of webhookEmails) categories.push((await runPipeline(json, { demo: true })).record.category);
    assert.deepEqual(categories, ['Support', 'Meeting / Scheduling', 'Spam / Low Priority']);
  });

  await test('mock replies are personalised, signed and use placeholders', () => {
    for (const r of demoRecords.filter((x) => x.requires_reply)) {
      assert.equal(r.reply_status, 'drafted');
      assert.match(r.suggested_reply, /^Hi [A-Z][a-z]+,/);
      assert.match(r.suggested_reply, /Alex Morgan\nCustomer Success, Northwind Analytics$/);
      assert.match(r.suggested_reply, /\[[^\]]+\]/);
    }
    assert.match(demoRecords[3].suggested_reply, /Tuesday 6 Oct, 14:00 CET works well/);
  });

  console.log('\nFinal record');

  const records = [];
  for (const email of normalizedSamples) records.push((await runPipeline(email)).record);

  await test('every record has the same flat, ordered fields', () => {
    for (const r of [...records, ...demoRecords]) {
      assert.deepEqual(Object.keys(r), RECORD_FIELDS);
      for (const [k, v] of Object.entries(r)) assert.ok(v === null || typeof v !== 'object', `${k} is not a scalar`);
    }
  });

  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}\n`);
  console.log('Demo mode records (DEMO · Mock nodes, no API calls):');
  console.table(demoRecords.map((r) => ({ sender: r.sender, category: r.category, priority: `${r.priority} ${r.priority_label}`, reply: r.reply_status, status: r.status })));
})();
