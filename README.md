# Prompt Critique MVP on OpenAI

Node.js MVP that accepts text notes and voice notes, transcribes audio, generates a first prompt, critiques it, and produces an improved final prompt.

## Stack

- Backend: Node.js + Express
- Frontend: HTML + CSS + vanilla JavaScript
- LLM pipeline: OpenAI Responses API
- Speech-to-text: OpenAI Audio Transcriptions API

## Quick start

1. Copy `.env.example` to `.env`
2. Fill in `OPENAI_API_KEY`
3. Run `npm install`
4. Run `npm run dev`
5. Open `http://localhost:3000`
