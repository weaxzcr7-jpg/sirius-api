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

  try {
    const body = await req.json();
    const msgs = body.messages || [];
    const prompt =
      msgs.map((m) => m.content).join('\n\n') +
      '\n\nIMPORTANT: Watch minus signs in exponents carefully. Write brief math steps in "steps", then final values. Output ONLY raw valid JSON without markdown.';

    const geminiKeys = [
      ...(process.env.GEMINI_KEYS || '').split(','),
      process.env.GEMINI_KEY,
      process.env.GEMINI_KEY_2,
      process.env.GEMINI_KEY_3,
    ]
      .map((k) => (k || '').trim())
      .filter(Boolean);

    const errs = [];
    const started = Date.now();
    const timeLeft = () => Math.max(1500, 9200 - (Date.now() - started));

    // 1. Последовательный перебор Gemini (не сжигает квоту запасных моделей впустую)
    const geminiModels = ['gemini-3.1-flash-lite-preview', 'gemini-3-flash-preview'];
    for (const model of geminiModels) {
      for (let i = 0; i < geminiKeys.length; i++) {
        if (Date.now() - started > 8200) break;
        try {
          const r = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKeys[i]}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: AbortSignal.timeout(Math.min(5500, timeLeft())),
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
          const data = await r.json();
          if (!data.error) {
            const parts = data.candidates?.[0]?.content?.parts || [];
            const reply = parts.filter((p) => !p.thought).map((p) => p.text).join('').trim();
            if (reply) return replyJson({ choices: [{ message: { content: reply } }] });
          }
          errs.push(`${model}[k${i + 1}]: ${data.error?.message || 'empty'}`);
        } catch (e) {
          errs.push(`${model}[k${i + 1}]: ${e.message}`);
        }
      }
    }

    // 2. Резерв на Mistral (если добавлен MISTRAL_KEY в Netlify)
    const mistralKey = (process.env.MISTRAL_KEY || '').trim();
    if (mistralKey && Date.now() - started < 8500) {
      try {
        const r = await fetch('https://api.mistral.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mistralKey}`,
          },
          signal: AbortSignal.timeout(timeLeft()),
          body: JSON.stringify({
            model: 'mistral-small-latest',
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
              ...msgs,
              { role: 'user', content: 'Output ONLY raw valid JSON without markdown.' },
            ],
          }),
        });
        const data = await r.json();
        const reply = data.choices?.[0]?.message?.content?.trim();
        if (reply) return replyJson({ choices: [{ message: { content: reply } }] });
        errs.push(`mistral: ${data.message || data.error?.message || 'empty'}`);
      } catch (e) {
        errs.push(`mistral: ${e.message}`);
      }
    }

    // 3. Резерв на OpenRouter (если добавлен OPENROUTER_KEY в Netlify)
    const orKey = (process.env.OPENROUTER_KEY || '').trim();
    if (orKey && Date.now() - started < 8500) {
      try {
        const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${orKey}`,
          },
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
        errs.push(`openrouter: ${data.error?.message || 'empty'}`);
      } catch (e) {
        errs.push(`openrouter: ${e.message}`);
      }
    }

    return replyJson({ error: { message: errs.join(' | ') || 'No working API keys' } }, 400);
  } catch (e) {
    return replyJson({ error: { message: e.message } }, 400);
  }
};
