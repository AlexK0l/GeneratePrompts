const els = {
  noteText: document.getElementById('noteText'),
  startRecordingBtn: document.getElementById('startRecordingBtn'),
  stopRecordingBtn: document.getElementById('stopRecordingBtn'),
  runPipelineBtn: document.getElementById('runPipelineBtn'),
  resetBtn: document.getElementById('resetBtn'),
  audioPreview: document.getElementById('audioPreview'),
  recordingBadge: document.getElementById('recordingBadge'),
  statusBox: document.getElementById('statusBox'),
  backendStatusBadge: document.getElementById('backendStatusBadge'),
  backendStatusText: document.getElementById('backendStatusText'),
  sourceNoteOutput: document.getElementById('sourceNoteOutput'),
  promptOutput: document.getElementById('promptOutput'),
  metaOutput: document.getElementById('metaOutput')
};

const RAW_API_BASE_URL = String(window.APP_CONFIG?.API_BASE_URL || '').trim();
const API_BASE_URL = RAW_API_BASE_URL.replace(/\/$/, '');
const PLACEHOLDER_API_URL = 'https://your-backend.onrender.com';
const HEALTH_CHECK_INTERVAL_MS = 30000;
const HEALTH_CHECK_TIMEOUT_MS = 8000;
const PREFERRED_AUDIO_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
  'audio/mp4',
  'audio/wav'
];

let mediaRecorder = null;
let mediaStream = null;
let audioChunks = [];
let recordedBlob = null;
let currentAudioPreviewUrl = null;
let healthCheckTimer = null;
let backendConnectionState = 'checking';

function setStatus(message, variant = 'muted') {
  els.statusBox.className = `status-box ${variant}`;
  els.statusBox.textContent = message;
}

function setOutput(element, value) {
  element.textContent = value && String(value).trim() ? String(value).trim() : '—';
}

function appendToSharedNote(value) {
  const incomingText = String(value || '').trim();
  if (!incomingText) {
    return '';
  }

  const currentText = String(els.noteText.value || '').trim();
  const mergedText = currentText ? `${currentText}\n\n${incomingText}` : incomingText;
  els.noteText.value = mergedText;
  return mergedText;
}

function formatMeta(meta) {
  if (!meta) {
    return '—';
  }

  const lines = [];

  if (Array.isArray(meta.placeholdersUsed) && meta.placeholdersUsed.length > 0) {
    lines.push('Использованные placeholders:');
    meta.placeholdersUsed.forEach((item) => lines.push(`- ${item}`));
  }

  if (Array.isArray(meta.missingButRequired) && meta.missingButRequired.length > 0) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push('Недостающие, но обязательные поля:');
    meta.missingButRequired.forEach((item) => lines.push(`- ${item}`));
  }

  if (Array.isArray(meta.generationNotes) && meta.generationNotes.length > 0) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push('Служебные заметки генерации:');
    meta.generationNotes.forEach((item) => lines.push(`- ${item}`));
  }

  return lines.length > 0 ? lines.join('\n') : '—';
}

function resetOutputs() {
  setOutput(els.sourceNoteOutput, '—');
  setOutput(els.promptOutput, '—');
  setOutput(els.metaOutput, '—');
}

function stopTracks() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
}

function setRecordingState(recording) {
  els.startRecordingBtn.disabled = recording;
  els.stopRecordingBtn.disabled = !recording;
  els.recordingBadge.textContent = recording ? 'Идёт запись' : 'Не записывается';
  els.recordingBadge.classList.toggle('recording', recording);
}

function setBackendStatus(state, text, details) {
  backendConnectionState = state;
  els.backendStatusBadge.className = `connection-badge ${state}`;
  els.backendStatusBadge.textContent = text;
  els.backendStatusText.textContent = details;
}

function resolveApiBaseUrl() {
  if (API_BASE_URL && API_BASE_URL !== PLACEHOLDER_API_URL) {
    return API_BASE_URL;
  }

  if (window.location?.origin) {
    return window.location.origin;
  }

  throw new Error(
    'Не настроен frontend -> backend URL. Откройте public/config.js и укажите реальный Render Web Service URL в APP_CONFIG.API_BASE_URL.'
  );
}

function buildApiUrl(path) {
  const baseUrl = resolveApiBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

function getSupportedRecordingMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }

  return PREFERRED_AUDIO_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || '';
}

function getFileExtensionByMimeType(mimeType) {
  const normalizedMimeType = String(mimeType || '').split(';')[0].trim().toLowerCase();

  const map = {
    'audio/webm': 'webm',
    'video/webm': 'webm',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'mp4',
    'video/mp4': 'mp4',
    'audio/x-m4a': 'm4a',
    'audio/m4a': 'm4a',
    'audio/ogg': 'ogg',
    'audio/oga': 'oga',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/aac': 'aac'
  };

  return map[normalizedMimeType] || 'webm';
}

async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch (error) {
    return null;
  }
}

async function checkBackendConnection(options = {}) {
  const { silent = false } = options;

  const usingConfiguredUrl = API_BASE_URL && API_BASE_URL !== PLACEHOLDER_API_URL;
  const resolvedBaseUrl = resolveApiBaseUrl();

  if (!silent) {
    setBackendStatus('checking', 'Проверка...', `Проверяю доступность backend: ${resolvedBaseUrl}`);
  }

  try {
    const response = await fetch(buildApiUrl('/api/health'), {
      method: 'GET',
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS)
    });

    const payload = await readJsonSafe(response);

    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error?.message || 'Backend ответил с ошибкой на health-check.');
    }

    setBackendStatus('online', 'Онлайн', `Backend доступен: ${resolvedBaseUrl}`);

    if (!silent) {
      setStatus(
        usingConfiguredUrl
          ? 'Связь с backend установлена. Система готова к работе.'
          : 'Связь с backend установлена. Используется текущий origin сайта.',
        'success'
      );
    }

    return true;
  } catch (error) {
    setBackendStatus(
      usingConfiguredUrl ? 'offline' : 'config',
      usingConfiguredUrl ? 'Недоступен' : 'Проверьте URL',
      usingConfiguredUrl
        ? `Не удаётся подключиться к backend: ${resolvedBaseUrl}. Проверьте Render Web Service, CORS и public/config.js.`
        : 'Backend по текущему origin недоступен. Укажите явный URL backend в public/config.js, если frontend и backend разнесены.'
    );

    if (!silent) {
      setStatus(`Backend недоступен: ${error.message}`, 'error');
    }

    return false;
  }
}

function startBackendHealthChecks() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
  }

  healthCheckTimer = setInterval(() => {
    checkBackendConnection({ silent: true });
  }, HEALTH_CHECK_INTERVAL_MS);
}

async function uploadAndTranscribe(blob) {
  if (!blob || blob.size <= 0) {
    throw new Error('Записанное аудио пустое. Повторите запись ещё раз.');
  }

  const normalizedMimeType = String(blob.type || 'audio/webm').split(';')[0].trim().toLowerCase();
  const extension = getFileExtensionByMimeType(normalizedMimeType);
  const formData = new FormData();
  formData.append('audio', blob, `voice-note.${extension}`);

  setStatus('Загружаю аудио и запускаю транскрибацию...', 'muted');

  const response = await fetch(buildApiUrl('/api/transcribe'), {
    method: 'POST',
    body: formData
  });

  const payload = await readJsonSafe(response);

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message || 'Не удалось транскрибировать аудио.');
  }

  const mergedNote = appendToSharedNote(payload.transcript || '');
  setOutput(els.sourceNoteOutput, mergedNote || '—');
  setStatus('Голосовая заметка распознана и добавлена в общее поле заметки.', 'success');
}

async function startRecording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Этот браузер не поддерживает запись аудио через MediaRecorder API.');
  }

  const isBackendAvailable = await checkBackendConnection({ silent: true });
  if (!isBackendAvailable) {
    throw new Error('Backend недоступен. Дождитесь восстановления связи или проверьте настройки подключения.');
  }

  audioChunks = [];
  recordedBlob = null;

  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const selectedMimeType = getSupportedRecordingMimeType();
  const recorderOptions = selectedMimeType ? { mimeType: selectedMimeType } : undefined;
  mediaRecorder = new MediaRecorder(mediaStream, recorderOptions);

  mediaRecorder.addEventListener('dataavailable', (event) => {
    if (event.data && event.data.size > 0) {
      audioChunks.push(event.data);
    }
  });

  mediaRecorder.addEventListener('stop', async () => {
    try {
      const recordedMimeType = mediaRecorder.mimeType || selectedMimeType || 'audio/webm';
      recordedBlob = new Blob(audioChunks, { type: recordedMimeType });

      if (currentAudioPreviewUrl) {
        URL.revokeObjectURL(currentAudioPreviewUrl);
      }

      currentAudioPreviewUrl = URL.createObjectURL(recordedBlob);
      els.audioPreview.src = currentAudioPreviewUrl;
      els.audioPreview.classList.remove('hidden');
      await uploadAndTranscribe(recordedBlob);
    } catch (error) {
      setStatus(error.message, 'error');
      await checkBackendConnection({ silent: true });
    } finally {
      stopTracks();
      setRecordingState(false);
      mediaRecorder = null;
    }
  });

  mediaRecorder.start();
  setRecordingState(true);
  setStatus('Запись началась. Говорите свободно, затем нажмите «Остановить запись».', 'muted');
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    return;
  }

  mediaRecorder.stop();
  setStatus('Запись остановлена. Обрабатываю аудио...', 'muted');
}

async function runPipeline() {
  const noteText = els.noteText.value.trim();

  if (!noteText) {
    throw new Error('Добавьте заметку или надиктуйте голосовую заметку перед запуском.');
  }

  const isBackendAvailable = await checkBackendConnection({ silent: true });
  if (!isBackendAvailable) {
    throw new Error('Backend недоступен. Невозможно отправить заметку на генерацию промпта.');
  }

  els.runPipelineBtn.disabled = true;
  setStatus('Отправляю данные на генерацию итогового промпта...', 'muted');

  const response = await fetch(buildApiUrl('/api/prompt/pipeline'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ noteText })
  });

  const payload = await readJsonSafe(response);

  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error?.message || 'Не удалось сгенерировать промпт.');
  }

  const { source, results } = payload;

  setOutput(els.sourceNoteOutput, source.normalizedInput || source.noteText);
  setOutput(els.promptOutput, results.prompt);
  setOutput(els.metaOutput, formatMeta(results.meta));
  setStatus('Промпт успешно сгенерирован.', 'success');
}

function resetAll() {
  els.noteText.value = '';
  els.audioPreview.removeAttribute('src');
  els.audioPreview.classList.add('hidden');

  if (currentAudioPreviewUrl) {
    URL.revokeObjectURL(currentAudioPreviewUrl);
    currentAudioPreviewUrl = null;
  }

  recordedBlob = null;
  audioChunks = [];
  resetOutputs();

  if (backendConnectionState === 'online') {
    setStatus('Форма очищена. Связь с backend активна, можно продолжать.', 'muted');
  } else if (backendConnectionState === 'offline') {
    setStatus('Форма очищена. Backend сейчас недоступен.', 'error');
  } else if (backendConnectionState === 'config') {
    setStatus(
      'Форма очищена. При необходимости укажите APP_CONFIG.API_BASE_URL в public/config.js.',
      'error'
    );
  } else {
    setStatus('Форма очищена. Система готова к новой заметке.', 'muted');
  }
}

els.startRecordingBtn.addEventListener('click', async () => {
  try {
    await startRecording();
  } catch (error) {
    setStatus(error.message, 'error');
    stopTracks();
    setRecordingState(false);
  }
});

els.stopRecordingBtn.addEventListener('click', () => {
  stopRecording();
});

els.runPipelineBtn.addEventListener('click', async () => {
  try {
    await runPipeline();
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    els.runPipelineBtn.disabled = false;
  }
});

els.resetBtn.addEventListener('click', () => {
  resetAll();
});

resetOutputs();
setBackendStatus('checking', 'Проверка...', 'Выполняется первичная проверка доступности backend.');
checkBackendConnection();
startBackendHealthChecks();
