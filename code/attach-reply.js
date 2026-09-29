// n8n Code node: "Attach Reply"
// Mode: Run Once for Each Item
//
// Reads the drafted reply from the Claude response and attaches it to the
// email record. A failed draft keeps the analysis and flags the record for
// review instead of failing the execution.

const request = $('Build Reply Request').item.json;
const response = $json;
const { anthropic_request, anthropic_headers, ...email } = request;

try {
  const reply = readReply(response);
  return { json: { ...email, suggested_reply: reply, reply_status: 'drafted' } };
} catch (err) {
  return {
    json: {
      ...email,
      suggested_reply: '',
      reply_status: 'failed',
      status: 'needs_review',
      status_detail: [email.status_detail, `reply: ${err.message}`].filter(Boolean).join('; '),
    },
  };
}

function readReply(res) {
  if (res.error) {
    const e = res.error;
    throw new Error(`API error: ${typeof e === 'string' ? e : e.message || JSON.stringify(e)}`);
  }
  if (res.stop_reason === 'refusal') throw new Error('model declined the request (refusal)');
  if (res.stop_reason === 'max_tokens') throw new Error('response hit max_tokens; raise reply_max_tokens in Config');

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
  if (typeof data.reply_body !== 'string' || !data.reply_body.trim()) throw new Error('empty reply');
  return data.reply_body.trim();
}
