const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { modelConfig } = require('../config/models');
const { runPipelineController, transcribeAudioController } = require('../controllers/promptController');
const { HttpError } = require('../utils/httpError');

const router = express.Router();
const uploadDir = path.join(process.cwd(), 'tmp', 'audio');

fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: modelConfig.transcription.maxAudioSizeBytes
  },
  fileFilter: (req, file, callback) => {
    const allowed = [
      'audio/webm',
      'audio/wav',
      'audio/mpeg',
      'audio/mp4',
      'audio/x-m4a',
      'audio/aac',
      'audio/ogg'
    ];

    if (!allowed.includes(file.mimetype)) {
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
