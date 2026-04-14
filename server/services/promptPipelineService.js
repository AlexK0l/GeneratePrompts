const { sendStructuredOpenAiRequest } = require('./openaiResponsesService');
const { generationSystemPrompt, critiqueSystemPrompt, improveSystemPrompt } = require('../prompts/systemPrompts');
const { HttpError } = require('../utils/httpError');

function requireObject(parsed, stageName) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(502, `Некорректный формат ответа модели на этапе: ${stageName}.`, { parsed });
  }
  return parsed;
}

async function generateInitialPrompt(normalizedInput) {
  const userMessage = `
Сырые данные пользователя:
${normalizedInput}

Сгенерируй первый вариант промпта согласно инструкции.
`.trim();

  const response = await sendStructuredOpenAiRequest({
    stage: 'generate',
    instructions: generationSystemPrompt(),
    userInput: userMessage
  });

  const parsed = requireObject(response.parsed, 'generate');

  return {
    prompt: parsed.prompt || '',
    placeholdersUsed: Array.isArray(parsed.placeholders_used) ? parsed.placeholders_used : [],
    missingButRequired: Array.isArray(parsed.missing_but_required) ? parsed.missing_but_required : [],
    notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    rawText: response.text
  };
}

async function critiquePrompt({ normalizedInput, initialPrompt }) {
  const userMessage = `
Исходные данные пользователя:
${normalizedInput}

Первый вариант промпта:
${initialPrompt}

Проведи критический разбор.
`.trim();

  const response = await sendStructuredOpenAiRequest({
    stage: 'critique',
    instructions: critiqueSystemPrompt(),
    userInput: userMessage
  });

  const parsed = requireObject(response.parsed, 'critique');

  return {
    summary: parsed.summary || '',
    score: Number.isFinite(parsed.score) ? parsed.score : null,
    issues: Array.isArray(parsed.issues) ? parsed.issues : [],
    strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
    improvementBrief: Array.isArray(parsed.improvement_brief) ? parsed.improvement_brief : [],
    rawText: response.text
  };
}

async function improvePrompt({ normalizedInput, initialPrompt, critique }) {
  const critiquePayload = JSON.stringify(critique, null, 2);
  const userMessage = `
Исходные данные пользователя:
${normalizedInput}

Первый вариант промпта:
${initialPrompt}

Критика:
${critiquePayload}

Создай улучшенную финальную версию.
`.trim();

  const response = await sendStructuredOpenAiRequest({
    stage: 'improve',
    instructions: improveSystemPrompt(),
    userInput: userMessage
  });

  const parsed = requireObject(response.parsed, 'improve');

  return {
    finalPrompt: parsed.final_prompt || '',
    changeLog: Array.isArray(parsed.change_log) ? parsed.change_log : [],
    rawText: response.text
  };
}

async function runPromptPipeline(normalizedInput) {
  const initial = await generateInitialPrompt(normalizedInput);

  if (!initial.prompt) {
    throw new HttpError(502, 'Модель не вернула первичный промпт.');
  }

  const critique = await critiquePrompt({
    normalizedInput,
    initialPrompt: initial.prompt
  });

  const improved = await improvePrompt({
    normalizedInput,
    initialPrompt: initial.prompt,
    critique: {
      summary: critique.summary,
      score: critique.score,
      issues: critique.issues,
      strengths: critique.strengths,
      improvementBrief: critique.improvementBrief
    }
  });

  if (!improved.finalPrompt) {
    throw new HttpError(502, 'Модель не вернула финальный улучшенный промпт.');
  }

  return {
    initial,
    critique,
    improved
  };
}

module.exports = { runPromptPipeline };
