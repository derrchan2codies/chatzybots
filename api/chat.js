// Vercel serverless function: POST /api/chat
//
// Flow for every message:
//   1. Decisions API (gpt-6-luna) -> "yes" or "no": is it specifically about menorrhagia?
//   2. "no"  -> respond { decision: "no" }  (front end pops the notice box; chat model NOT called)
//      "yes" -> call gpt-6-luna chat model -> respond { decision: "yes", reply }

const CHAT_MODEL = 'gpt-6-luna';
const DECISION_MODEL = 'gpt-6-luna'; // the only model the Decisions API supports
const MASTER_PROMPT = 'You are an AI assistant that will answer in EN';
const DECISION_PROMPT = 'Evaluate whether what is written is specifically about menorrhagia or not. Answer yes only if the latest user message is specifically about menorrhagia (heavy menstrual bleeding); otherwise answer no.';

const HEADERS = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
});

// Step 1: Decisions API gate -> returns 'yes' or 'no'
async function decide(messages) {
  const latest = messages[messages.length - 1].content;
  const earlier = messages.slice(0, -1)
    .map(m => `${m.role === 'user' ? 'User' : 'Bot'}: ${m.content}`).join('\n');
  const input = (earlier ? `Conversation so far:\n${earlier}\n\n` : '') + `Latest user message:\n${latest}`;

  const response = await fetch('https://api.openai.com/v1/decisions', {
    method: 'POST',
    headers: HEADERS(),
    body: JSON.stringify({
      model: DECISION_MODEL,
      input,
      questions: [{
        type: 'choice',
        name: 'about_menorrhagia',
        instructions: DECISION_PROMPT,
        choices: [
          { value: 'yes', description: 'The latest user message is specifically about menorrhagia (heavy menstrual bleeding).' },
          { value: 'no',  description: 'The latest user message is about anything else.' }
        ]
      }]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Decisions request failed.');

  const answer = data.answers?.[0];
  // A refusal or anything unexpected is treated as "no" (fail-safe).
  return answer?.type === 'choice' && answer.choice === 'yes' ? 'yes' : 'no';
}

// Step 2: only reached when the decision is "yes"
async function chat(messages) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: HEADERS(),
    body: JSON.stringify({
      model: CHAT_MODEL,
      // Master prompt is always applied to every request sent to the bot.
      messages: [{ role: 'system', content: MASTER_PROMPT }, ...messages]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || 'Chat request failed.');
  return data.choices?.[0]?.message?.content?.trim() || '';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'OPENAI_API_KEY is not configured.' });
  }

  const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const messages = incoming
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'No user message provided.' });
  }

  try {
    const decision = await decide(messages);
    if (decision === 'no') {
      return res.status(200).json({ decision: 'no', reply: null });
    }
    const reply = await chat(messages);
    return res.status(200).json({ decision: 'yes', reply });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Request failed.' });
  }
}
