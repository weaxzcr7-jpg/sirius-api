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
      '\n\nIMPORTANT: Pay strict attention to minus signs in exponents (e.g. ^(-15), ^(-20)). Solve step by step. Output ONLY raw valid JSON without markdown.';
    const models = ['gemini-3.8-flash', 'gemini-3.1-flash-lite-preview'];
    const errs = [];

    for (const model of models) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text }] }],
              generationConfig: {
                temperature: 0,
                maxOutputTokens: 2048,
                responseMimeType: 'application/json',
                thinkingConfig: { thinkingBudget: 256 },
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
        if (!/high demand|overloaded|503/i.test(data.error.message)) break;
        await new Promise((res) => setTimeout(res, 1000));
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
