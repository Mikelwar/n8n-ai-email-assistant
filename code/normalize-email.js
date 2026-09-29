// n8n Code node: "Normalize Email"
// Mode: Run Once for All Items
//
// Turns every supported input into one canonical email shape, so the rest of
// the workflow never has to care where an email came from:
//   - Demo mode:     items from "DEMO · Load Sample Emails"
//   - Webhook mode:  { headers, body } where body is one email, an array of
//                    emails, or { emails: [...] }
//   - Gmail mode:    Gmail Trigger output (simplified or full format)

const results = [];

for (const [itemIndex, item] of $input.all().entries()) {
  const { source, emails } = unwrap(item.json);

  emails.forEach((email, n) => {
    results.push({
      json: normalize(email ?? {}, source, `${itemIndex}-${n}`),
      pairedItem: { item: itemIndex },
    });
  });
}

return results;

// ---------------------------------------------------------------------------

function unwrap(raw) {
  // Webhook node output always has headers + body
  if (raw.headers && raw.body !== undefined) {
    const body = raw.body;
    const emails = Array.isArray(body) ? body : Array.isArray(body?.emails) ? body.emails : [body];
    return { source: 'webhook', emails };
  }
  // Gmail Trigger output always carries a threadId
  if (raw.threadId) {
    return { source: 'gmail', emails: [raw] };
  }
  return { source: raw.source || 'manual', emails: [raw] };
}

function normalize(e, source, key) {
  const { address, name } = parseSender(e.from ?? e.From ?? e.sender);
  const timestamp = toIso(e.timestamp ?? e.received_at ?? e.date ?? e.internalDate);
  const rawBody = e.body ?? e.text ?? e.textPlain ?? htmlToText(e.html ?? e.textHtml) ?? e.snippet ?? '';

  return {
    message_id: String(e.message_id ?? e.messageId ?? e.id ?? `${source}-${Date.now()}-${key}`),
    thread_id: e.thread_id ?? e.threadId ?? null,
    source,
    sender: address,
    sender_name: e.sender_name ?? name,
    subject: String(e.subject ?? e.Subject ?? '').trim() || '(no subject)',
    body: cleanBody(String(rawBody)),
    timestamp: timestamp.iso,
    timestamp_inferred: timestamp.inferred,
  };
}

// Accepts "Jane Doe <jane@x.com>", "jane@x.com", { address, name },
// or Gmail's { value: [{ address, name }], text }.
function parseSender(from) {
  if (from && typeof from === 'object') {
    const first = Array.isArray(from.value) ? from.value[0] : from;
    if (first?.address) {
      return { address: first.address.toLowerCase(), name: first.name || '' };
    }
    from = from.text;
  }
  const text = String(from ?? '').trim();
  const angled = text.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (angled) {
    return { address: angled[2].trim().toLowerCase(), name: angled[1].trim() };
  }
  const bare = text.match(/[^\s<>]+@[^\s<>]+/);
  return { address: bare ? bare[0].toLowerCase() : 'unknown', name: '' };
}

function toIso(value) {
  if (value !== undefined && value !== null && value !== '') {
    // Gmail's internalDate is epoch milliseconds, sometimes as a string
    const asNumber = /^\d{12,}$/.test(String(value)) ? Number(value) : value;
    const date = new Date(asNumber);
    if (!isNaN(date.getTime())) {
      return { iso: date.toISOString(), inferred: false };
    }
  }
  return { iso: new Date().toISOString(), inferred: true };
}

function htmlToText(html) {
  if (!html) return undefined;
  return String(html)
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanBody(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
