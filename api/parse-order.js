// Vercel serverless function: реальное распознавание заказа через Claude API
// вместо локального JS-эвристического парсера.
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Простая структурированная задача извлечения данных — Haiku 4.5 достаточно
// и, в отличие от Opus/Sonnet 5-го поколения, поддерживает temperature (нужна
// предсказуемость, а не творчество).
const MODEL = 'claude-haiku-4-5';

const FIELDS = ['flowers', 'items', 'budget', 'deliveryText', 'deliveryDate', 'deliveryTime', 'address', 'clientName', 'clientPhone', 'channel'];

const MAX_TEXT_LENGTH = 5000;

function emptyResult(rawText) {
  var out = { raw_text: rawText };
  FIELDS.forEach(function (f) { out[f] = null; });
  out.items = [];
  return out;
}

// now — текущие дата/время магазина из браузера, чтобы «завтра» превратить в настоящую дату.
// flowerNames — названия со склада, чтобы состав букета совпадал с ними (нужно для аналитики).
function buildPrompt(text, now, flowerNames) {
  return (
    'Ты извлекаешь структурированные данные заказа цветочного магазина из текста переписки с клиентом.\n\n' +
    'Сейчас у магазина: ' + now + '. Относительные даты («завтра», «в субботу», «8 марта») считай от этого момента.\n' +
    (flowerNames.length
      ? 'Названия цветов на складе магазина: ' + flowerNames.join(', ') + '. В items используй ровно эти названия, ' +
        'если цветок совпадает по смыслу (например «красные розы» -> название розы со склада).\n'
      : '') +
    '\nВерни ТОЛЬКО валидный JSON без пояснений, комментариев или markdown-разметки, строго по схеме:\n' +
    '{\n' +
    '  "flowers": строка (состав букета как в тексте) или null,\n' +
    '  "items": массив [{"flower": строка, "qty": число или null}] — каждый цветок отдельно; [] если состав не указан,\n' +
    '  "budget": число (в тенге) или null,\n' +
    '  "deliveryText": строка (дата/время доставки дословно как в тексте) или null,\n' +
    '  "deliveryDate": строка "YYYY-MM-DD" или null,\n' +
    '  "deliveryTime": строка "HH:MM" (24 часа) или null; «к 18:00» и «до 18» — это "18:00",\n' +
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

// модель иногда отклоняется от формата — пропускаем только валидные значения
function sanitize(result) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result.deliveryDate || '')) result.deliveryDate = null;
  if (!/^\d{1,2}:\d{2}$/.test(result.deliveryTime || '')) result.deliveryTime = null;
  result.items = Array.isArray(result.items)
    ? result.items
        .filter(function (it) { return it && typeof it.flower === 'string' && it.flower.trim(); })
        .map(function (it) {
          return { flower: it.flower.trim(), qty: Number.isFinite(it.qty) && it.qty > 0 ? Math.round(it.qty) : null };
        })
    : [];
  return result;
}

// Пускаем только залогиненных сотрудников: проверяем Supabase access token,
// иначе любой, кто знает URL, может тратить наш ключ Claude API.
async function getUser(req) {
  var auth = req.headers.authorization || '';
  var token = auth.indexOf('Bearer ') === 0 ? auth.slice(7) : '';
  if (!token || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return null;
  var r = await fetch(process.env.SUPABASE_URL + '/auth/v1/user', {
    headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }
  });
  return r.ok ? r.json() : null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  var user = await getUser(req).catch(function () { return null; });
  if (!user) {
    res.status(401).json({ error: 'Требуется вход' });
    return;
  }

  var body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};
  var text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  if (text.length > MAX_TEXT_LENGTH) {
    res.status(400).json({ error: 'Текст слишком длинный (максимум ' + MAX_TEXT_LENGTH + ' символов)' });
    return;
  }
  var now = typeof body.now === 'string' && body.now.length <= 80 ? body.now : new Date().toISOString();
  var flowerNames = Array.isArray(body.flowerNames)
    ? body.flowerNames.filter(function (n) { return typeof n === 'string' && n.length <= 60; }).slice(0, 100)
    : [];

  var message;
  try {
    message = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      temperature: 0,
      messages: [{ role: 'user', content: buildPrompt(text, now, flowerNames) }]
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
  res.status(200).json(sanitize(result));
};
