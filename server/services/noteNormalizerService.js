const { HttpError } = require('../utils/httpError');

function cleanText(value) {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeNoteInput({ noteText, transcriptText }) {
  const cleanedNote = cleanText(noteText);
  const cleanedTranscript = cleanText(transcriptText);

  if (!cleanedNote && !cleanedTranscript) {
    throw new HttpError(400, 'Нужно передать текстовую заметку или текст из голосовой заметки.');
  }

  const segments = [];

  if (cleanedNote) {
    segments.push('Текстовая заметка пользователя:\n' + cleanedNote);
  }

  if (cleanedTranscript) {
    segments.push('Распознанный текст голосовой заметки:\n' + cleanedTranscript);
  }

  return {
    noteText: cleanedNote,
    transcriptText: cleanedTranscript,
    normalizedInput: segments.join('\n\n')
  };
}

module.exports = { normalizeNoteInput };
