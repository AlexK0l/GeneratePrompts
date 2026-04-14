const els = {
  noteText: document.getElementById('noteText'),
  transcriptText: document.getElementById('transcriptText'),
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
  transcriptOutput: document.getElementById('transcriptOutput'),
  promptOutput: document.getElementById('promptOutput'),
  metaOutput: document.getElementById('metaOutput')
};

const RAW_API_BASE_URL = window.APP_CONFIG?.API_BASE_URL || '';
const API_BASE_URL = RAW_API_BASE_URL.replace(/\/$/, '');
const PLACEHOLDER_API_URL = 'https://your-backend.onrender.com';
const HEALTH_CHECK_INTERVAL_MS = 30000;
const HEALTH_CHECK_TIMEOUT_MS = 8000;

let mediaRecorder = null;
let mediaStream = null;
let audioChunks = [];
let recordedBlob = null;
let healthCheckTimer = null;
let backendConnectionState = 'checking';

function setStatus(message, variant = 'muted') {
  els.statusBox.className = `status-box ${variant}`;
  els.statusBox.textContent = message;
}

function setOutput(element, value) {
  element.textContent = value && String(value).trim() ? String(value).trim() : '—';
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
  setOutput(els.transcriptOutput, '—');
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

function ensureApiConfigured() {
  if (!API_BASE_URL || API_BASE_URL === PLACEHOLDER_API_URL) {
    throw new Error(
      'Не настроен frontend -> backend URL. Откройте public/config.js и укажите реальный Render Web Service URL в APP_CONFIG.API_BASE_URL.'
    );
  }

  return API_BASE_URL;
}

function buildApiUrl(path) {
  const baseUrl = ensureApiConfigured();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

async function checkBackendConnection(options = {}) {
  const { silent = false } = options;

  if (!API_BASE_URL || API_BASE_URL === PLACEHOLDER_API_URL) {
    setBackendStatus(
      'config',
      'Не настроен',
      'Укажите реальный URL backend в public/config.js, чтобы frontend мог обращаться к Render Web Service.'
    );

    if (!silent) {
      setStatus(
        'Укажите адрес backend в public/config.js: замените APP_CONFIG.API_BASE_URL на URL вашего Render Web Service.',
        'error'
      );
    }

    return false;
  }

  if (!silent) {
    setBackendStatus('checking', 'Проверка...', `Проверяю доступность backend: ${API_BASE_URL}`);
  }

  try {
    const response = await fetch(buildApiUrl('/api/health'), {
      method: 'GET',
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS)
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error?.message || 'Backend ответил с ошибкой на health-check.');
    }

    setBackendStatus('online', 'Онлайн', `Backend доступен: ${API_BASE_URL}`);

    if (!silent) {
      setStatus('Связь с backend установлена. Система готова к работе.', 'success');
    }

    return true;
  } catch (error) {
    setBackendStatus(
      'offline',
      'Недоступен',
      `Не удаётся подключиться к backend: ${API_BASE_URL}. Проверьте Render Web Service, CORS и public/config.js.`
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
  const formData = new FormData();
  formData.append('audio', blob, 'voice-note.webm');

  setStatus('Загружаю аудио и запускаю транскрибацию...', 'muted');

  const response = await fetch(buildApiUrl('/api/transcribe'), {
    method: 'POST',
    body: formData
  });

  const payload = await response.json();

  if (!response.ok || !payload.ok) {
    throw new Error(payload?.error?.message || 'Не удалось транскрибировать аудио.');
  }

  els.transcriptText.value = payload.transcript || '';
  setOutput(els.transcriptOutput, payload.transcript || '—');
  setStatus('Голосовая заметка успешно распознана. Можно генерировать промпт.', 'success');
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
  mediaRecorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm' });

  mediaRecorder.addEventListener('dataavailable', (event) => {
    if (event.data && event.data.size > 0) {
      audioChunks.push(event.data);
    }
  });

  mediaRecorder.addEventListener('stop', async () => {
    try {
      recordedBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const audioUrl = URL.createObjectURL(recordedBlob);
      els.audioPreview.src = audioUrl;
      els.audioPreview.classList.remove('hidden');
      await uploadAndTranscribe(recordedBlob);
    } catch (error) {
      setStatus(error.message, 'error');
      await checkBackendConnection({ silent: true });
    } finally {
      stopTracks();
      setRecordingState(false);
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
  const transcriptText = els.transcriptText.value.trim();

  if (!noteText && !transcriptText) {
    throw new Error('Добавьте текстовую заметку или голосовую заметку перед запуском.');
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
    body: JSON.stringify({ noteText, transcriptText })
  });

  const payload = await response.json();

  if (!response.ok || !payload.ok) {
    throw new Error(payload?.error?.message || 'Не удалось сгенерировать промпт.');
  }

  const { source, results } = payload;

  setOutput(els.sourceNoteOutput, source.noteText);
  setOutput(els.transcriptOutput, source.transcriptText);
  setOutput(els.promptOutput, results.prompt);
  setOutput(els.metaOutput, formatMeta(results.meta));
  setStatus('Промпт успешно сгенерирован.', 'success');
}

function resetAll() {
  els.noteText.value = '';
  els.transcriptText.value = '';
  els.audioPreview.removeAttribute('src');
  els.audioPreview.classList.add('hidden');
  recordedBlob = null;
  audioChunks = [];
  resetOutputs();

  if (backendConnectionState === 'online') {
    setStatus('Форма очищена. Связь с backend активна, можно продолжать.', 'muted');
  } else if (backendConnectionState === 'offline') {
    setStatus('Форма очищена. Backend сейчас недоступен.', 'error');
  } else if (backendConnectionState === 'config') {
    setStatus(
      'Форма очищена. Сначала настройте APP_CONFIG.API_BASE_URL в public/config.js.',
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
