// n8n Code node: "DEMO · Mock Draft Reply"
// Mode: Run Once for Each Item
//
// Demo-mode stand-in for "Claude · Draft Reply". It runs only when
// config.demo_mode is true and makes no external calls.
//
// Builds a reply from the email itself (sender's first name, subject, their
// question, proposed time slots) with a template per category, and returns it
// in the shape of a Claude Messages API response, so "Attach Reply" runs
// unchanged. Like the real prompt, it uses [placeholders] instead of inventing
// prices, dates or policies.

const email = $json;
const config = email.config;

const firstName = (email.sender_name || '').split(/\s+/)[0];
const sentences = contentSentences(email.body);
const request = sentences.find((s) => /\?|\b(could|can|would) you\b|\bplease\b|\bi'?d like\b/i.test(s));
const options = timeOptions(email.body);

let middle;
switch (email.category) {
  case 'Urgent':
    middle = [
      `Thank you for flagging this, and I'm sorry for the disruption. I've escalated "${email.subject}" to our engineering team as a priority, and we're investigating now.`,
      `I'll send you an update by [time of next update]. In the meantime, [workaround, if one is available].`,
      'If anything changes on your side, just reply to this email.',
    ];
    break;

  case 'Sales / Lead':
    middle = [
      `Thank you for reaching out and for considering ${config.company_name}.`,
      request
        ? `Regarding your request to ${asTask(request)}: [add pricing and plan details].`
        : '[Answer the questions about pricing and plans.]',
      "I'd be glad to show you the platform in a short demo. Would [propose two time slots] work for you and your team?",
    ];
    break;

  case 'Support':
    middle = [
      'Thank you for reporting this and for the helpful details.',
      `I've shared "${email.subject}" with our support team so they can look into it. [Add ticket number and expected response time.]`,
      "[Add a workaround or next step, if available.] We'll keep you updated until it's resolved.",
    ];
    break;

  case 'Meeting / Scheduling':
    if (options.length) {
      middle = [
        `Thank you for suggesting some times. ${options[0]} works well for me [confirm availability], and I'll send a calendar invite shortly.`,
        'Looking forward to the conversation.',
      ];
    } else if (/\b(move|reschedul|postpone|push)/i.test(email.body)) {
      middle = [
        "No problem at all. [Confirm the new time] works for us, and I'll update the calendar invite accordingly.",
        'Thanks for letting me know in advance.',
      ];
    } else {
      middle = ["Thanks for reaching out. I'd be happy to set up a call. Would [propose two time slots] work for you?"];
    }
    break;

  default:
    middle = [
      `Thank you for your message about "${email.subject}".`,
      request ? `Regarding your question: [answer: ${asTask(request)}].` : '[Add a short personal reply.]',
    ];
}

const reply_body = [firstName ? `Hi ${firstName},` : 'Hello,', ...middle, `Best regards,\n${config.signature}`].join('\n\n');

// Same shape as a Claude Messages API response with structured output.
return {
  json: {
    id: `mock_reply_${email.message_id}`,
    type: 'message',
    role: 'assistant',
    model: 'demo-mock',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify({ reply_body }) }],
    usage: { input_tokens: 0, output_tokens: 0 },
  },
};

// ---------------------------------------------------------------------------

// "Could you send pricing for 40 seats?" -> "send pricing for 40 seats"
function asTask(sentence) {
  const task = sentence
    .replace(/^\s*(hi|hello)[^,]*,\s*/i, '')
    .replace(/^(could|can|would) you (please )?/i, '')
    .replace(/^please /i, '')
    .replace(/[?.!]+$/, '')
    .trim();
  const words = task.split(/\s+/);
  const short = words.length > 30 ? `${words.slice(0, 30).join(' ')}…` : task;
  return short.charAt(0).toLowerCase() + short.slice(1);
}

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

function timeOptions(body) {
  return String(body || '')
    .split('\n')
    .map((l) => l.match(/^\s*[-•*]\s+(.+)$/))
    .filter(Boolean)
    .map((m) => m[1].trim())
    .filter((s) => /\d/.test(s));
}
