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
      '\n\nIMPORTANT: Watch minus signs in exponents carefully. First write brief math steps in "steps", then final values in "answers". Output ONLY raw valid JSON without markdown.';

    const configs = [
      { model: 'gemini-3.1-flash-lite-preview', budget: 0 },
      { model: 'gemini-3-flash-preview', budget: 128 },
    ];
    const errs = [];

    for (const { model, budget } of configs) {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(4500),
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text }] }],
              generationConfig: {
                temperature: 0,
                maxOutputTokens: 1536,
                responseMimeType: 'application/json',
                thinkingConfig: { thinkingBudget: budget },
              },
            }),
          }
        );
        const data = await r.json();
        if (!data.error) {
          const parts = data.candidates?.[0]?.content?.parts || [];
          const reply =
            parts
              .filter((p) => !p.thought)
              .map((p) => p.text)
              .join('') || '';
          return new Response(
            JSON.stringify({ choices: [{ message: { content: reply } }] }),
            { headers: { ...cors, 'Content-Type': 'application/json' } }
          );
        }
        errs.push(`${model}: ${data.error.message}`);
      } catch (err) {
        errs.push(`${model}: ${err.message}`);
      }
    }

    return new Response(
      JSON.stringify({ error: { message: errs.join(' | ') } }),
      {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: e.message } }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
};
