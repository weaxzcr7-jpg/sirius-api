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

    const models = [
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash',
      'gemini-3-flash-preview',
    ];

    const now = Date.now();
    for (const model of models) {
      if (Date.now() - started > 7800) break;
      const mid = `model:${model}`;
      if ((cooldown.get(mid) || 0) > now) continue;

      for (const key of geminiKeys) {
        if (Date.now() - started > 7800) break;
        const kid = `key:${key.slice(-8)}`;
        const cid = `${model}:${key.slice(-8)}`;
        if ((cooldown.get(kid) || 0) > now || (cooldown.get(cid) || 0) > now) continue;

        try {
          const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: AbortSignal.timeout(Math.min(3200, timeLeft())),
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                  temperature: 0,
                  maxOutputTokens: 1536,
                  responseMimeType: 'application/json',
                  thinkingConfig: { thinkingBudget: 0 },
                },
              }),
            }
          );
          const data = await r.json().catch(() => ({}));
          if (!data.error) {
            const parts = data.candidates?.[0]?.content?.parts || [];
            const reply = parts.filter((p) => !p.thought).map((p) => p.text).join('').trim();
            if (reply) return replyJson({ choices: [{ message: { content: reply } }] });
          }
          const msg = data.error?.message || `HTTP ${r.status}`;
          if (r.status === 429 || /quota|limit|exceeded/i.test(msg)) {
            cooldown.set(cid, Date.now() + 10 * 60 * 1000);
          } else if (r.status === 404 || /not found/i.test(msg)) {
            cooldown.set(mid, Date.now() + 30 * 60 * 1000);
            errs.push(`${model}[..${key.slice(-4)}]: ${msg.slice(0, 90)}`);
            break;
          } else if (r.status === 503 || /high demand|overloaded|unavailable/i.test(msg)) {
            cooldown.set(mid, Date.now() + 2 * 60 * 1000);
            errs.push(`${model}[..${key.slice(-4)}]: ${msg.slice(0, 90)}`);
            break;
          } else if (r.status === 401 || r.status === 403 || /permission denied|not valid/i.test(msg)) {
            cooldown.set(kid, Date.now() + 30 * 60 * 1000);
          }
          errs.push(`${model}[..${key.slice(-4)}]: ${msg.slice(0, 90)}`);
        } catch (e) {
          errs.push(`${model}[..${key.slice(-4)}]: ${e.message}`);
          break;
        }
      }
    }

    // Резерв на OpenRouter (если заданы OPENROUTER_KEY*)
    const orModels = ['openrouter/free', 'google/gemma-3-27b-it:free'];
    for (const key of orKeys) {
      if (Date.now() - started > 8500) break;
      const cid = `or:${key.slice(-8)}`;
      if ((cooldown.get(cid) || 0) > now) continue;
      for (const orModel of orModels) {
        if (Date.now() - started > 8500) break;
        try {
          const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            signal: AbortSignal.timeout(timeLeft()),
            body: JSON.stringify({
              model: orModel,
              temperature: 0,
              messages: msgs,
            }),
          });
          const data = await r.json().catch(() => ({}));
          const reply = data.choices?.[0]?.message?.content?.trim();
          if (reply) return replyJson({ choices: [{ message: { content: reply } }] });
          if (r.status === 429) cooldown.set(cid, Date.now() + 5 * 60 * 1000);
          errs.push(`or/${orModel}[..${key.slice(-4)}]: ${data.error?.message || `HTTP ${r.status}`}`);
        } catch (e) {
          errs.push(`or/${orModel}[..${key.slice(-4)}]: ${e.message}`);
        }
      }
    }

    // Резерв на Mistral (если заданы MISTRAL_KEY*)
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
        const data = await r.json().catch(() => ({}));
        const reply = data.choices?.[0]?.message?.content?.trim();
        if (reply) return replyJson({ choices: [{ message: { content: reply } }] });
        if (r.status === 429) cooldown.set(cid, Date.now() + 5 * 60 * 1000);
        errs.push(`mistral[..${key.slice(-4)}]: ${data.message || data.error?.message || 'empty'}`);
      } catch (e) {
        errs.push(`mistral[..${key.slice(-4)}]: ${e.message}`);
      }
    }

    return replyJson({ error: { message: errs.join(' | ') || 'Нет активных ключей' } }, 400);
  } catch (e) {
    return replyJson({ error: { message: e.message } }, 400);
  }
};
