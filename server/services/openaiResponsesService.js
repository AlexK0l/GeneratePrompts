const OpenAI = require('openai');
const { env } = require('../config/env');
const { modelConfig } = require('../config/models');
const { HttpError } = require('../utils/httpError');

const client = new OpenAI({ apiKey: env.openAiApiKey });

const generationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    prompt: { type: 'string' },
    placeholders_used: {
      type: 'array',
      items: { type: 'string' }
    },
    missing_but_required: {
      type: 'array',
      items: { type: 'string' }
    },
    notes: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['prompt', 'placeholders_used', 'missing_but_required', 'notes']
};

const critiqueSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    score: { type: 'number' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          problem: { type: 'string' },
          fix: { type: 'string' }
        },
        required: ['title', 'severity', 'problem', 'fix']
      }
    },
    strengths: {
      type: 'array',
      items: { type: 'string' }
    },
    improvement_brief: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['summary', 'score', 'issues', 'strengths', 'improvement_brief']
};

const improveSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    final_prompt: { type: 'string' },
    change_log: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['final_prompt', 'change_log']
};

function getSchemaForStage(stage) {
  if (stage === 'generate') return { name: 'generated_prompt_payload', schema: generationSchema };
  if (stage === 'critique') return { name: 'prompt_critique_payload', schema: critiqueSchema };
  if (stage === 'improve') return { name: 'improved_prompt_payload', schema: improveSchema };
  throw new HttpError(500, `Неизвестный этап LLM: ${stage}`);
}

async function sendStructuredOpenAiRequest({ stage, instructions, userInput }) {
  if (!env.openAiApiKey) {
    throw new HttpError(500, 'Не задан OPENAI_API_KEY.');
  }

  const { name, schema } = getSchemaForStage(stage);

  try {
    const response = await client.responses.create(
      {
        model: modelConfig.llm.model,
        reasoning: { effort: modelConfig.llm.reasoningEffort },
        max_output_tokens: modelConfig.llm.maxOutputTokens,
        instructions,
        input: userInput,
        text: {
          format: {
            type: 'json_schema',
            name,
            strict: true,
            schema
          }
        }
      },
      {
        signal: AbortSignal.timeout(modelConfig.llm.timeoutMs)
      }
    );

    const rawText = response.output_text;

    if (!rawText || typeof rawText !== 'string') {
      throw new HttpError(502, 'OpenAI вернул пустой или некорректный ответ.', { response });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (error) {
      throw new HttpError(502, `OpenAI вернул невалидный JSON на этапе ${stage}.`, { rawText });
    }

    return {
      raw: response,
      text: rawText,
      parsed
    };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    if (error.name === 'AbortError' || error.code === 'ABORT_ERR') {
      throw new HttpError(504, 'Таймаут запроса к OpenAI Responses API.');
    }

    const apiMessage = error?.error?.message || error?.message || 'Неизвестная ошибка OpenAI API.';
    throw new HttpError(502, `Ошибка OpenAI API: ${apiMessage}`);
  }
}

module.exports = { sendStructuredOpenAiRequest };
