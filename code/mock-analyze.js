// n8n Code node: "DEMO · Mock Analyze"
// Mode: Run Once for Each Item
//
// Demo-mode stand-in for "Claude · Analyze Email". It runs only when
// config.demo_mode is true and makes no external calls.
//
// A small keyword heuristic reads the email and returns a response in exactly
// the shape of a Claude Messages API response, so "Parse & Score Analysis"
// and everything after it run unchanged. This is deterministic demo logic,
// not a model. Use production mode to judge real classification quality.

const email = $json;
const text = `${email.subject}\n${email.body}`.toLowerCase();

const SIGNALS = {
  spam: ['gift card', 'you have been selected', 'you have won', 'claim now', 'bank details', 'lottery', 'unsubscribe', 'limited time offer', 'ignore all previous instructions', 'ignore previous instructions'],
  urgent: ['urgent', 'asap', 'outage', 'not loading', 'not working', 'is down', 'blocked', 'cannot access', "can't access", 'security incident', 'data loss', 'right away', 'immediately'],
  sales: ['pricing', 'price', 'quote', 'seats', 'demo', 'plan', 'upgrade', 'contract', 'license', 'trial', 'enterprise', 'renew'],
  meeting: ['meeting', 'call', 'schedule', 'reschedule', 'time slot', 'calendar', 'availability', 'would any of these work', 'finding a time', 'find a time', 'move tomorrow'],
  support: ['error', 'bug', 'issue', 'problem', 'export', 'how do i', 'not able to', 'charged', 'refund', 'invoice', 'billing', 'workaround'],
};
const TIME_PRESSURE = /\b(today|this morning|right away|immediately|asap|within the hour|tonight)\b/;
const DEADLINE = /\b(deadline|renews?|by (mon|tues|wednes|thurs|fri)day|end of (the )?(month|quarter)|next week|\d{1,2} (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\b/;
const SOON = /\b(today|tomorrow|tomorrow's)\b/;
const NO_ACTION = /\b(no action needed|no need to reply|fyi|just wanted to)\b/;

const hits = Object.fromEntries(
  Object.entries(SIGNALS).map(([key, phrases]) => [key, phrases.filter((p) => new RegExp(`\\b${escapeRegex(p)}`).test(text))]),
);

const who = email.sender_name || email.sender;
const sentences = contentSentences(email.body);
const first = sentences[0] || email.subject;
const request = sentences.find((s) => /\?|\b(could|can|would) you\b|\bplease\b|\bi'?d like\b/i.test(s)) || first;

let analysis;

if (hits.spam.length) {
  const injection = /ignore (all )?previous instructions|ai (email )?assistant/.test(text);
  analysis = {
    category: 'Spam / Low Priority',
    confidence: 0.97,
    summary: limitWords(`Unsolicited message from ${email.sender} ("${email.subject}").${injection ? ' It contains instructions aimed at AI assistants, which were ignored.' : ''}`),
    priority_score: 1,
    priority_reason: `Unsolicited or manipulative content (signals: ${quoteList(hits.spam)}).`,
    requires_reply: false,
  };
} else if (hits.urgent.length >= 2 || (hits.urgent.length && TIME_PRESSURE.test(text))) {
  analysis = {
    category: 'Urgent',
    confidence: confidence(hits.urgent.length),
    summary: limitWords(`${who} reports an urgent problem: "${first}"`),
    priority_score: 4,
    priority_reason: `Blocking problem with time pressure (signals: ${quoteList(hits.urgent)}).`,
    requires_reply: true,
  };
} else {
  // Most signals wins; ties go to the category listed first.
  const [best] = ['sales', 'support', 'meeting']
    .map((key) => ({ key, count: hits[key].length }))
    .sort((a, b) => b.count - a.count);

  if (best.count === 0) {
    const asksSomething = /\?/.test(email.body) && !NO_ACTION.test(text);
    analysis = {
      category: 'General',
      confidence: 0.7,
      summary: limitWords(`${who} shares a note: "${first}"`),
      priority_score: asksSomething ? 2 : 1,
      priority_reason: asksSomething ? 'Legitimate message with a question but no deadline.' : 'Informational message with no request or deadline.',
      requires_reply: asksSomething,
    };
  } else if (best.key === 'sales') {
    const deadline = DEADLINE.test(text);
    analysis = {
      category: 'Sales / Lead',
      confidence: confidence(best.count),
      summary: limitWords(`${who} is interested in buying: "${request}"`),
      priority_score: deadline ? 4 : 3,
      priority_reason: `Buying intent${deadline ? ' with a stated deadline' : ''} (signals: ${quoteList(hits.sales)}).`,
      requires_reply: true,
    };
  } else if (best.key === 'meeting') {
    const options = timeOptions(email.body);
    const soon = SOON.test(text);
    analysis = {
      category: 'Meeting / Scheduling',
      confidence: confidence(best.count),
      summary: limitWords(
        options.length
          ? `${who} wants to schedule "${email.subject}" and proposes ${options.length} time slots, starting ${options[0]}.`
          : `${who} has a scheduling request: "${request}"`,
      ),
      priority_score: soon ? 4 : 3,
      priority_reason: soon ? 'Scheduling change for a meeting within the next 24 hours.' : 'Scheduling request without same-day urgency.',
      requires_reply: true,
    };
  } else {
    analysis = {
      category: 'Support',
      confidence: confidence(best.count),
      summary: limitWords(`${who} needs help: "${first}"`),
      priority_score: 3,
      priority_reason: `Product or account issue without an emergency (signals: ${quoteList(hits.support)}).`,
      requires_reply: true,
    };
  }
}

// Same shape as a Claude Messages API response with structured output.
return {
  json: {
    id: `mock_${email.message_id}`,
    type: 'message',
    role: 'assistant',
    model: 'demo-mock',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(analysis) }],
    usage: { input_tokens: 0, output_tokens: 0 },
  },
};

// ---------------------------------------------------------------------------

// Body sentences without the greeting line and the sign-off.
function contentSentences(body) {
  const lines = String(body || '').split('\n').filter((l) => !/^\s*[-•*]\s/.test(l));
  if (/^\s*(hi|hello|hey|dear|good (morning|afternoon))\b/i.test(lines[0] || '')) lines.shift();
  const signOff = lines.findIndex((l) => /^\s*(thanks|thank you|best|cheers|regards|kind regards|best regards)\b[\s\S]{0,20}[,!]?\s*$/i.test(l));
  const content = (signOff > 0 ? lines.slice(0, signOff) : lines).join(' ');
  return content
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 15);
}

// Bullet lines that look like proposed times, e.g. "- Tuesday 6 Oct, 14:00 CET".
function timeOptions(body) {
  return String(body || '')
    .split('\n')
    .map((l) => l.match(/^\s*[-•*]\s+(.+)$/))
    .filter(Boolean)
    .map((m) => m[1].trim())
    .filter((s) => /\d/.test(s));
}

function confidence(signalCount) {
  return Math.min(0.95, Math.round((0.55 + 0.1 * signalCount) * 100) / 100);
}

function quoteList(list) {
  return list.slice(0, 3).map((s) => `"${s}"`).join(', ');
}

function limitWords(s, max = 40) {
  const words = s.split(/\s+/);
  return words.length <= max ? s : `${words.slice(0, max).join(' ')}…`;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
