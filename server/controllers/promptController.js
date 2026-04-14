const fs = require('fs/promises');
const { normalizeNoteInput } = require('../services/noteNormalizerService');
const { runPromptPipeline } = require('../services/promptPipelineService');
const { transcribeAudio } = require('../services/transcriptionService');
const { HttpError } = require('../utils/httpError');

async function transcribeAudioController(req, res, next) {
  const file = req.file;

  if (!file) {
    return next(new HttpError(400, 'Аудиофайл не был загружен.'));
  }

  try {
    const result = await transcribeAudio(file.path, file.mimetype);
    return res.json({
      ok: true,
      transcript: result.transcript,
      meta: {
        mimeType: result.mimeType,
        model: result.model,
        originalName: file.originalname,
        size: file.size
      }
    });
  } catch (error) {
    return next(error);
  } finally {
    await fs.unlink(file.path).catch(() => {});
  }
}

async function runPipelineController(req, res, next) {
  try {
    const { noteText, transcriptText } = req.body || {};
    const normalized = normalizeNoteInput({ noteText, transcriptText });
    const pipeline = await runPromptPipeline(normalized.normalizedInput);

    return res.json({
      ok: true,
      source: {
        noteText: normalized.noteText,
        transcriptText: normalized.transcriptText,
        normalizedInput: normalized.normalizedInput
      },
      results: {
        initialPrompt: pipeline.initial.prompt,
        critique: {
          summary: pipeline.critique.summary,
          score: pipeline.critique.score,
          strengths: pipeline.critique.strengths,
          issues: pipeline.critique.issues,
          improvementBrief: pipeline.critique.improvementBrief
        },
        finalPrompt: pipeline.improved.finalPrompt,
        meta: {
          placeholdersUsed: pipeline.initial.placeholdersUsed,
          missingButRequired: pipeline.initial.missingButRequired,
          generationNotes: pipeline.initial.notes,
          changeLog: pipeline.improved.changeLog
        }
      }
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  transcribeAudioController,
  runPipelineController
};
