// Vercel serverless function: POST /api/chat
//
// Flow for every message:
//   1. Decisions API (gpt-6-luna) -> "yes" or "no": is it specifically about menorrhagia?
//   2. "no"  -> respond { decision: "no" }  (front end pops the notice box; chat model NOT called)
//      "yes" -> call chat model -> respond { decision: "yes", reply }

export const config = { maxDuration: 60 }; // two sequential model calls can exceed the 10s default

const OPENAI_BASE = 'https://api.openai.com/v1';
const CHAT_MODEL = 'gpt-6-luna';
const DECISION_MODEL = 'gpt-6-luna'; // the only model the Decisions API supports

// Backticks: safe for apostrophes ("patient's") and line breaks.
const MASTER_PROMPT = `You are a artificial intelligence entity conducting a full gynaecological history that relentlessly hones in on menorrhagia to gather maximal diagnostic information and ultimately arrive at a working diagnosis; the patient always opens the conversation so your very first reply in every new interaction must be exactly the sentence Please tell me more about this condition of yours and nothing else before that & for every question afterwards remember to one question at a time and not multiple questions at a time; Also thereafter remain talkative, empathetic and clinically thorough while restricting every question and probe exclusively to aspects of the patient's menorrhagia (duration, frequency, volume, clots, flooding, pad or tampon count, associated pain, intermenstrual bleeding, post-coital bleeding, cycle regularity, age of menarche, parity, contraceptive history, previous treatments, systemic symptoms such as fatigue or shortness of breath, family history of bleeding disorders, and impact on daily life) and if the patient drifts off-topic gently but firmly redirect her with phrases that acknowledge the aside then steer straight back to the menorrhagia details still needed; continue systematic yet conversational questioning until sufficient data exist to formulate a reasoned differential and a most-likely diagnosis which you then present clearly together with the key supporting features elicited; Then as an ending tell the patient what is her diagnosis and how you will treat her.`;

const DECISION_PROMPT = `Evaluate whether what is written is specifically about menorrhagia (such as any mention at all about bleeding alot in the girlie part, private part, or pussy) or not. Answer yes only if the latest user message is specifically about heavy bleeding downstairs; otherwise answer no.`;

// One guarded helper for every OpenAI call: timeout + tolerant of non-JSON error pages.
async function openai(path, body, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response, text;
  try {
    response = await fetch(`${OPENAI_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    text = await response.text();
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? `OpenAI ${path} timed out` : `OpenAI ${path} network error: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try { data = JSON.parse(text); } catch { /* non-JSON body, handled below */ }

  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI ${path} returned ${response.status}: ${text.slice(0, 200)}`);
  }
  if (!data) throw new Error(`OpenAI ${path} returned non-JSON.`);
  return data;
}

// Step 1: Decisions API gate -> 'yes' or 'no'
async function decide(messages) {
  const latest = messages[messages.length - 1].content;
  const earlier = messages.slice(0, -1)
    .map(m => `${m.role === 'user' ? 'User' : 'Bot'}: ${m.content}`)
    .join('\n');
  const input = (earlier ? `Conversation so far:\n${earlier}\n\n` : '') + `Latest user message:\n${latest}`;

  const data = await openai('/decisions', {
    model: DECISION_MODEL,
    input,
    questions: [{
      type: 'choice',
      name: 'about_menorrhagia',
      instructions: DECISION_PROMPT,
      choices: [
        { value: 'yes', description: 'The latest user message is specifically about something related to heavy menstrual bleeding.' },
        { value: 'no',  description: 'The latest user message is about anything else.' }
      ]
    }]
  });

  const answer = data.answers?.[0];
  // A refusal or anything unexpected is treated as "no" (fail-safe).
  return answer?.type === 'choice' && answer.choice === 'yes' ? 'yes' : 'no';
}

// Step 2: only reached when the decision is "yes"
async function chat(messages) {
  const data = await openai('/chat/completions', {
    model: CHAT_MODEL,
    messages: [{ role: 'system', content: MASTER_PROMPT }, ...messages]
  });
  return data.choices?.[0]?.message?.content?.trim() || '';
}

function parseBody(req) {
  if (req.body == null) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed.' });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OPENAI_API_KEY is not configured.' });
    }

    const body = parseBody(req);
    const incoming = Array.isArray(body.messages) ? body.messages : [];
    const messages = incoming
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content }));

    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'No user message provided.' });
    }

    const decision = await decide(messages);
    if (decision === 'no') {
      return res.status(200).json({ decision: 'no', reply: null });
    }
    const reply = await chat(messages);
    return res.status(200).json({ decision: 'yes', reply });
  } catch (error) {
    console.error('/api/chat failed:', error);
    return res.status(500).json({ error: error?.message || 'Request failed.' });
  }
}
