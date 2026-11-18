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
    const text = body.messages.map((m) => m.content).join('\n\n') + '\n\nIMPORTANT: Output ONLY raw valid JSON without markdown or extra text.';
    const models = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
    const errs = [];

    for (const model of models) {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text }] }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 1024,
              responseMimeType: 'application/json',
              thinkingConfig: { thinkingBudget: 256 },
            },
          }),
        }
      );
      const data = await r.json();
      if (!data.error) {
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return new Response(
          JSON.stringify({ choices: [{ message: { content: reply } }] }),
          { headers: { ...cors, 'Content-Type': 'application/json' } }
        );
      }
      errs.push(`${model}: ${data.error.message}`);
    }

    return new Response(JSON.stringify({ error: { message: errs.join(' | ') } }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: { message: e.message } }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
};
