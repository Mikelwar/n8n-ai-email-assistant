// n8n Code node: "Build Final Record"
// Mode: Run Once for Each Item
//
// Produces the workflow's public output: one flat, fixed-order JSON record per
// email. Flat scalar fields map 1:1 onto a spreadsheet row, a Notion database,
// an n8n Data Table, or CRM fields, so every logging target uses this record
// unchanged. Internal fields (config, full body) are deliberately left out.

const e = $json;

const rules = (e.priority_rules || []).join(', ');
const notes = [e.status_detail, e.body_truncated ? 'body truncated for analysis' : '', e.timestamp_inferred ? 'timestamp missing, used processing time' : '']
  .filter(Boolean)
  .join('; ');

return {
  json: {
    message_id: e.message_id,
    source: e.source,
    timestamp: e.timestamp,
    sender: e.sender,
    sender_name: e.sender_name || '',
    subject: e.subject,
    category: e.category,
    confidence: e.confidence,
    priority: e.priority,
    priority_label: e.priority_label,
    priority_reason: rules ? `${e.priority_reason} [rules: ${rules}]` : e.priority_reason,
    summary: e.summary,
    requires_reply: e.requires_reply,
    suggested_reply: e.suggested_reply || '',
    reply_status: e.reply_status || 'skipped',
    status: e.status,
    notes,
    model: e.model_used || '',
    processed_at: new Date().toISOString(),
  },
};
