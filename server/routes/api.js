const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { modelConfig } = require('../config/models');
const { runPipelineController, transcribeAudioController } = require('../controllers/promptController');
const { HttpError } = require('../utils/httpError');

const router = express.Router();
const uploadDir = path.join(process.cwd(), 'tmp', 'audio');

fs.mkdirSync(uploadDir, { recursive: true });

function guessExtensionByMime(mimeType) {
  const normalizedMimeType = String(mimeType || '').split(';')[0].trim().toLowerCase();

  const map = {
    'audio/webm': '.webm',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/mp4': '.mp4',
    'audio/x-m4a': '.m4a',
    'audio/m4a': '.m4a'
  };

  return map[normalizedMimeType] || '.webm';
}

const storage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, uploadDir);
  },
  filename: (req, file, callback) => {
    const originalExt = path.extname(file.originalname || '').toLowerCase();
    const safeExt = originalExt || guessExtensionByMime(file.mimetype);
    const uniqueName = `${Date.now()}-${crypto.randomUUID()}${safeExt}`;
    callback(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: modelConfig.transcription.maxAudioSizeBytes
  },
  fileFilter: (req, file, callback) => {
    const normalizedMimeType = String(file.mimetype || '').split(';')[0].trim().toLowerCase();
    const allowed = [
      'audio/webm',
      'audio/wav',
      'audio/x-wav',
      'audio/mpeg',
      'audio/mp3',
      'audio/mp4',
      'audio/x-m4a',
      'audio/m4a'
    ];

    if (!allowed.includes(normalizedMimeType)) {
      return callback(new HttpError(400, `Неподдерживаемый тип аудио: ${file.mimetype}`));
    }

    return callback(null, true);
  }
});

router.get('/health', (req, res) => {
  res.json({ ok: true, message: 'API is healthy' });
});

router.post('/transcribe', upload.single('audio'), transcribeAudioController);
router.post('/prompt/pipeline', runPipelineController);

module.exports = { router };
