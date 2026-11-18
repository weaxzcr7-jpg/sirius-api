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
    const models = ['gemini-2.5-flash-lite', 'gemini-3.1-flash-lite-preview', 'gemma-3-27b-it'];
    let lastError = 'Error';

    for (const model of models) {
      const isGemma = model.startsWith('gemma');
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 1024,
              ...(isGemma ? {} : { responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } }),
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
      lastError = `[${model}] ${data.error.message}`;
    }

    return new Response(JSON.stringify({ error: { message: lastError } }), {
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
