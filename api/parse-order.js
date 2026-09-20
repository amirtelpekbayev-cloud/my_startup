// Vercel serverless function: реальное распознавание заказа через Claude API
// вместо локального JS-эвристического парсера.
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Простая структурированная задача извлечения данных — Haiku 4.5 достаточно
// и, в отличие от Opus/Sonnet 5-го поколения, поддерживает temperature (нужна
// предсказуемость, а не творчество).
const MODEL = 'claude-haiku-4-5';

const FIELDS = ['flowers', 'budget', 'deliveryDate', 'address', 'clientName', 'clientPhone', 'channel'];

function emptyResult(rawText) {
  var out = { raw_text: rawText };
  FIELDS.forEach(function (f) { out[f] = null; });
  return out;
}

function buildPrompt(text) {
  return (
    'Ты извлекаешь структурированные данные заказа цветочного магазина из текста переписки с клиентом.\n\n' +
    'Верни ТОЛЬКО валидный JSON без пояснений, комментариев или markdown-разметки, строго по схеме:\n' +
    '{\n' +
    '  "flowers": строка или null,\n' +
    '  "budget": число (в тенге) или null,\n' +
    '  "deliveryDate": строка (как написано в тексте, не форматируй) или null,\n' +
    '  "address": строка или null,\n' +
    '  "clientName": строка или null,\n' +
    '  "clientPhone": строка или null,\n' +
    '  "channel": одно из "whatsapp", "instagram", null\n' +
    '}\n\n' +
    'Правила:\n' +
    '- Если поле явно не упомянуто в тексте — верни null. Никогда не придумывай значения.\n' +
    '- budget — только число без валюты и пробелов, если сумма явно указана.\n' +
    '- channel заполняй только при явном указании источника в тексте.\n\n' +
    'Текст переписки:\n' + text
  );
}

function extractJson(text) {
  var fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  var candidate = fenced ? fenced[1] : text;
  return JSON.parse(candidate.trim());
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  var body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  var text = body && typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  var message;
  try {
    message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      temperature: 0,
      messages: [{ role: 'user', content: buildPrompt(text) }]
    });
  } catch (err) {
    console.error('Anthropic API error:', err);
    res.status(500).json({ error: 'Не удалось получить ответ от Claude API: ' + (err && err.message ? err.message : String(err)) });
    return;
  }

  var textBlock = message.content.find(function (b) { return b.type === 'text'; });
  var raw = textBlock ? textBlock.text : '';

  var parsed;
  try {
    parsed = extractJson(raw);
  } catch (err) {
    res.status(200).json(emptyResult(raw));
    return;
  }

  var result = emptyResult(raw);
  FIELDS.forEach(function (f) {
    if (parsed && Object.prototype.hasOwnProperty.call(parsed, f)) result[f] = parsed[f];
  });
  res.status(200).json(result);
};
