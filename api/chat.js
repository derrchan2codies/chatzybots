{\rtf1\ansi\ansicpg1252\cocoartf2869
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 // Vercel serverless function: POST /api/chat\
const MODEL = 'gpt-6-luna';\
const MASTER_PROMPT = 'You are an AI assistant that will answer in EN';\
\
export default async function handler(req, res) \{\
  if (req.method !== 'POST') \{\
    res.setHeader('Allow', 'POST');\
    return res.status(405).json(\{ error: 'Method not allowed.' \});\
  \}\
  if (!process.env.OPENAI_API_KEY) \{\
    return res.status(500).json(\{ error: 'OPENAI_API_KEY is not configured.' \});\
  \}\
\
  const incoming = Array.isArray(req.body?.messages) ? req.body.messages : [];\
  const messages = incoming\
    .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')\
    .map(m => (\{ role: m.role, content: m.content \}));\
  if (!messages.length) return res.status(400).json(\{ error: 'No message provided.' \});\
\
  try \{\
    const response = await fetch('https://api.openai.com/v1/chat/completions', \{\
      method: 'POST',\
      headers: \{\
        'Content-Type': 'application/json',\
        Authorization: `Bearer $\{process.env.OPENAI_API_KEY\}`\
      \},\
      body: JSON.stringify(\{\
        model: MODEL,\
        // Master prompt is always applied to every request sent to the bot.\
        messages: [\{ role: 'system', content: MASTER_PROMPT \}, ...messages]\
      \})\
    \});\
    const data = await response.json();\
    if (!response.ok) \{\
      return res.status(response.status).json(\{ error: data.error?.message || 'Upstream request failed.' \});\
    \}\
    const reply = data.choices?.[0]?.message?.content?.trim() || '';\
    return res.status(200).json(\{ reply \});\
  \} catch (error) \{\
    return res.status(500).json(\{ error: error.message || 'Request failed.' \});\
  \}\
\}}