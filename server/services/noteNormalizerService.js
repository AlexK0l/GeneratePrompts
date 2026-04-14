const { HttpError } = require('../utils/httpError');

function cleanText(value) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeNoteInput({ sourceText }) {
  const cleanedSourceText = cleanText(sourceText);

  if (!cleanedSourceText) {
    throw new HttpError(400, 'Нужно передать заметку перед запуском генерации промпта.');
  }

  return {
    sourceText: cleanedSourceText,
    normalizedInput: cleanedSourceText
  };
}

module.exports = { normalizeNoteInput };
