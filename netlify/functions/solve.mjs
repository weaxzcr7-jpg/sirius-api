const GEMINI_KEY = process.env.GEMINI_KEY;

export default async (req) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  try {
    const body = await req.json();
    const text =
      body.messages.map((m) => m.content).join('\n\n') +
      '\n\nIMPORTANT: Watch minus signs in exponents carefully. Write brief math steps in "steps", then final values. Output ONLY raw valid JSON without markdown.';

    const models = ['gemini-3.1-flash-lite-preview', 'gemini-3-flash-preview'];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error('Timeout 8.5s')), 8500);

    const ask = async (model) => {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ctrl.signal,
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text }] }],
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
      if (data.error) throw new Error(`${model}: ${data.error.message}`);
      const parts = data.candidates?.[0]?.content?.parts || [];
      const reply = parts.filter((p) => !p.thought).map((p) => p.text).join('').trim();
      if (!reply) throw new Error(`${model}: empty response`);
      return reply;
    };

    try {
      const reply = await Promise.any(models.map(ask));
      clearTimeout(timer);
      ctrl.abort();
      return new Response(
        JSON.stringify({ choices: [{ message: { content: reply } }] }),
        { headers: { ...cors, 'Content-Type': 'application/json' } }
      );
    } catch (agg) {
      clearTimeout(timer);
      const msg = (agg.errors || [agg]).map((e) => e.message).join(' | ');
      return new Response(JSON.stringify({ error: { message: msg } }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: e.message } }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
};
