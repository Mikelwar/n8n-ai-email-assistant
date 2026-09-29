// n8n Code node: "Parse & Score Analysis"
// Mode: Run Once for Each Item
//
// 1. Reads the Claude response and validates it.
// 2. Applies transparent business rules on top of the model's priority score.
// 3. Never drops an email: API errors, refusals and invalid output become a
//    record with status "needs_review" instead of a failed execution.

const request = $('Build Analysis Request').item.json;
const response = $json;
const { anthropic_request, anthropic_headers, ...email } = request;
const config = email.config;

const CATEGORIES = anthropic_request.output_config.format.schema.properties.category.enum;
const SPAM = 'Spam / Low Priority';
const PRIORITY_LABELS = { 1: 'Minimal', 2: 'Low', 3: 'Medium', 4: 'High', 5: 'Critical' };

let analysis;
try {
  analysis = readAnalysis(response);
} catch (err) {
  return {
    json: {
      ...email,
      category: 'General',
      confidence: 0,
      summary: 'Automatic analysis failed. Please review this email manually.',
      llm_priority: null,
      priority: 3,
      priority_label: PRIORITY_LABELS[3],
      priority_reason: 'Default priority because the automatic analysis was unavailable.',
      priority_rules: [],
      requires_reply: false,
      is_vip: false,
      status: 'needs_review',
      status_detail: `analysis: ${err.message}`,
      model_used: response.model ?? null,
    },
  };
}

// --- Business rules --------------------------------------------------------
// The model scores what the email says. These rules add what the business
// knows. Every adjustment is recorded so the final score is explainable.

const vipDomains = String(config.vip_domains || '')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);
const senderDomain = email.sender.split('@')[1] || '';
const isVip = vipDomains.some((d) => senderDomain === d || senderDomain.endsWith(`.${d}`));

const llmPriority = clamp(Math.round(Number(analysis.priority_score)), 1, 5);
let priority = llmPriority;
const rules = [];

if (analysis.category === SPAM) {
  if (priority !== 1) rules.push(`spam cap ${priority}→1`);
  priority = 1;
} else {
  if (analysis.category === 'Urgent' && priority < 4) {
    rules.push(`urgent floor ${priority}→4`);
    priority = 4;
  }
  if (isVip && priority < 5) {
    rules.push(`VIP sender ${priority}→${priority + 1}`);
    priority += 1;
  }
}

return {
  json: {
    ...email,
    category: analysis.category,
    confidence: Math.round(clamp(Number(analysis.confidence) || 0, 0, 1) * 100) / 100,
    summary: analysis.summary.trim(),
    llm_priority: llmPriority,
    priority,
    priority_label: PRIORITY_LABELS[priority],
    priority_reason: analysis.priority_reason.trim(),
    priority_rules: rules,
    requires_reply: Boolean(analysis.requires_reply) && analysis.category !== SPAM,
    is_vip: isVip,
    status: 'ok',
    status_detail: '',
    model_used: response.model ?? null,
  },
};

// ---------------------------------------------------------------------------

function readAnalysis(res) {
  if (res.error) {
    const e = res.error;
    throw new Error(`API error: ${typeof e === 'string' ? e : e.message || JSON.stringify(e)}`);
  }
  if (res.stop_reason === 'refusal') {
    throw new Error('model declined the request (refusal)');
  }
  if (res.stop_reason === 'max_tokens') {
    throw new Error('response hit max_tokens; raise analysis_max_tokens in Config');
  }

  const text = (res.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('response was not valid JSON');
  }

  if (!CATEGORIES.includes(data.category)) throw new Error(`unknown category "${data.category}"`);
  if (typeof data.summary !== 'string' || !data.summary.trim()) throw new Error('empty summary');
  if (!Number.isFinite(Number(data.priority_score))) throw new Error('missing priority_score');
  if (typeof data.priority_reason !== 'string') data.priority_reason = '';
  return data;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
