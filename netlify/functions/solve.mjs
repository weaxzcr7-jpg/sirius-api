const cooldown = new Map();

export default async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const replyJson = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });

  const env =
    typeof Netlify !== 'undefined' && Netlify.env?.toObject
      ? Netlify.env.toObject()
      : process.env;

  const getKeys = (prefix) => {
    const arr = [
      ...new Set(
        Object.entries(env)
          .filter(([k]) => k.startsWith(prefix))
          .flatMap(([, v]) => String(v || '').split(/[\s,;]+/))
          .map((s) => s.trim())
          .filter(Boolean)
      ),
    ];
    if (arr.length < 2) return arr;
    const shift = Math.floor(Math.random() * arr.length);
    return [...arr.slice(shift), ...arr.slice(0, shift)];
  };

  try {
    const body = await req.json();
    const msgs = body.messages || [];
    const prompt =
      msgs.map((m) => m.content).join('\n\n') +
      '\n\nIMPORTANT: Watch minus signs in exponents carefully. Write brief math steps in "steps", then final values. Output ONLY raw valid JSON without markdown.';

    const geminiKeys = getKeys('GEMINI_KEY');
    const mistralKeys = getKeys('MISTRAL_KEY');
    const orKeys = getKeys('OPENROUTER_KEY');

    const errs = [];
    const started = Date.now();
    const timeLeft = () => Math.max(1500, 9200 - (Date.now() - started));

    // 1. Все ключи Gemini (AI Studio и Vertex AI Express)
    const attempts = [];
    for (const key of geminiKeys) {
      const isVertex = key.startsWith('AQ.');
      const models = isVertex
        ? ['gemini-2.5-flash', 'gemini-3.1-flash-lite-preview', 'gemini-3-flash-preview']
        : ['gemini-3.1-flash-lite-preview', 'gemini-3-flash-preview'];
      for (const model of models) attempts.push({ key, isVertex, model });
    }
    const rank = (m) =>
      m === 'gemini-3.1-flash-lite-preview' ? 0 : m === 'gemini-2.5-flash' ? 1 : 2;
    attempts.sort((a, b) => rank(a.model) - rank(b.model));

    const now = Date.now();
    for (const { key, isVertex, model } of attempts) {
      if (Date.now() - started > 8200) break;
      const cid = `${model}:${key.slice(-8)}`;
      if ((cooldown.get(cid) || 0) > now) continue;

      const url = isVertex
        ? `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${key}`
        : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(Math.min(4500, timeLeft())),
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 1536,
              responseMimeType: 'application/json',
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
        });
        const data = await r.json();
        if (!data.error) {
          const parts = data.candidates?.[0]?.content?.parts || [];
          const reply = parts.filter((p) => !p.thought).map((p) => p.text).join('').trim();
          if (reply) return replyJson({ choices: [{ message: { content: reply } }] });
        }
        const msg = data.error?.message || `HTTP ${r.status}`;
        if (r.status === 429 || /quota|limit|exceeded/i.test(msg)) {
          cooldown.set(cid, Date.now() + 10 * 60 * 1000);
        } else if (r.status === 401 || r.status === 403 || /API key not valid/i.test(msg)) {
          cooldown.set(cid, Date.now() + 30 * 60 * 1000);
        }
        errs.push(`${model}[..${key.slice(-4)}]: ${msg}`);
      } catch (e) {
        errs.push(`${model}[..${key.slice(-4)}]: ${e.message}`);
      }
    }

    // 2. Все ключи Mistral (MISTRAL_KEY, MISTRAL_KEYS, MISTRAL_KEY_2...)
    for (const key of mistralKeys) {
      if (Date.now() - started > 8500) break;
      const cid = `mistral:${key.slice(-8)}`;
      if ((cooldown.get(cid) || 0) > now) continue;
      try {
        const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(timeLeft()),
          body: JSON.stringify({
            model: 'mistral-small-latest',
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [...msgs, { role: 'user', content: 'Output ONLY raw valid JSON without markdown.' }],
          }),
        });
        const data = await r.json();
        const reply = data.choices?.[0]?.message?.content?.trim();
        if (reply) return replyJson({ choices: [{ message: { content: reply } }] });
        if (r.status === 429) cooldown.set(cid, Date.now() + 5 * 60 * 1000);
        errs.push(`mistral[..${key.slice(-4)}]: ${data.message || data.error?.message || 'empty'}`);
      } catch (e) {
        errs.push(`mistral[..${key.slice(-4)}]: ${e.message}`);
      }
    }

    // 3. Все ключи OpenRouter (OPENROUTER_KEY, OPENROUTER_KEYS, OPENROUTER_KEY_2...)
    for (const key of orKeys) {
      if (Date.now() - started > 8500) break;
      const cid = `or:${key.slice(-8)}`;
      if ((cooldown.get(cid) || 0) > now) continue;
      try {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(timeLeft()),
          body: JSON.stringify({
            model: 'google/gemini-2.0-flash-exp:free',
            temperature: 0,
            messages: msgs,
          }),
        });
        const data = await r.json();
        const reply = data.choices?.[0]?.message?.content?.trim();
        if (reply) return replyJson({ choices: [{ message: { content: reply } }] });
        if (r.status === 429) cooldown.set(cid, Date.now() + 5 * 60 * 1000);
        errs.push(`or[..${key.slice(-4)}]: ${data.error?.message || 'empty'}`);
      } catch (e) {
        errs.push(`or[..${key.slice(-4)}]: ${e.message}`);
      }
    }

    return replyJson({ error: { message: errs.join(' | ') || 'Нет активных ключей' } }, 400);
  } catch (e) {
    return replyJson({ error: { message: e.message } }, 400);
  }
}; 
