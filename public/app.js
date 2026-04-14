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
  sourceNoteOutput: document.getElementById('sourceNoteOutput'),
  transcriptOutput: document.getElementById('transcriptOutput'),
  initialPromptOutput: document.getElementById('initialPromptOutput'),
  critiqueOutput: document.getElementById('critiqueOutput'),
  finalPromptOutput: document.getElementById('finalPromptOutput')
};

let mediaRecorder = null;
let mediaStream = null;
let audioChunks = [];
let recordedBlob = null;
let isRecording = false;

function setStatus(message, variant = 'muted') {
  els.statusBox.className = `status-box ${variant}`;
  els.statusBox.textContent = message;
}

function setOutput(element, value) {
  element.textContent = value && String(value).trim() ? String(value).trim() : '—';
}

function formatCritique(critique, meta) {
  if (!critique) {
    return '—';
  }

  const lines = [];

  if (critique.summary) {
    lines.push(`Итог: ${critique.summary}`);
  }

  if (typeof critique.score === 'number') {
    lines.push(`Оценка: ${critique.score}/10`);
  }

  if (Array.isArray(critique.strengths) && critique.strengths.length > 0) {
    lines.push('\nСильные стороны:');
    critique.strengths.forEach((item) => lines.push(`- ${item}`));
  }

  if (Array.isArray(critique.issues) && critique.issues.length > 0) {
    lines.push('\nПроблемы:');
    critique.issues.forEach((issue, index) => {
      lines.push(
        `${index + 1}. [${issue.severity}] ${issue.title}\n   Проблема: ${issue.problem}\n   Что исправить: ${issue.fix}`
      );
    });
  }

  if (Array.isArray(critique.improvementBrief) && critique.improvementBrief.length > 0) {
    lines.push('\nФокус улучшения:');
    critique.improvementBrief.forEach((item) => lines.push(`- ${item}`));
  }

  if (meta) {
    if (Array.isArray(meta.placeholdersUsed) && meta.placeholdersUsed.length > 0) {
      lines.push('\nИспользованные placeholders:');
      meta.placeholdersUsed.forEach((item) => lines.push(`- ${item}`));
    }

    if (Array.isArray(meta.missingButRequired) && meta.missingButRequired.length > 0) {
      lines.push('\nНедостающие, но обязательные поля:');
      meta.missingButRequired.forEach((item) => lines.push(`- ${item}`));
    }

    if (Array.isArray(meta.changeLog) && meta.changeLog.length > 0) {
      lines.push('\nЧто изменилось в финальной версии:');
      meta.changeLog.forEach((item) => lines.push(`- ${item}`));
    }
  }

  return lines.join('\n');
}

function resetOutputs() {
  setOutput(els.sourceNoteOutput, '—');
  setOutput(els.transcriptOutput, '—');
  setOutput(els.initialPromptOutput, '—');
  setOutput(els.critiqueOutput, '—');
  setOutput(els.finalPromptOutput, '—');
}

function stopTracks() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
}

function setRecordingState(recording) {
  isRecording = recording;
  els.startRecordingBtn.disabled = recording;
  els.stopRecordingBtn.disabled = !recording;
  els.recordingBadge.textContent = recording ? 'Идёт запись' : 'Не записывается';
  els.recordingBadge.classList.toggle('recording', recording);
}

async function uploadAndTranscribe(blob) {
  const formData = new FormData();
  formData.append('audio', blob, 'voice-note.webm');

  setStatus('Загружаю аудио и запускаю транскрибацию...', 'muted');

  const response = await fetch('/api/transcribe', {
    method: 'POST',
    body: formData
  });

  const payload = await response.json();

  if (!response.ok || !payload.ok) {
    throw new Error(payload?.error?.message || 'Не удалось транскрибировать аудио.');
  }

  els.transcriptText.value = payload.transcript || '';
  setOutput(els.transcriptOutput, payload.transcript || '—');
  setStatus('Голосовая заметка успешно распознана. Можно запускать пайплайн.', 'success');
}

async function startRecording() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Этот браузер не поддерживает запись аудио через MediaRecorder API.');
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

  els.runPipelineBtn.disabled = true;
  setStatus('Отправляю данные в pipeline: генерация -> критика -> улучшение...', 'muted');

  const response = await fetch('/api/prompt/pipeline', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ noteText, transcriptText })
  });

  const payload = await response.json();

  if (!response.ok || !payload.ok) {
    throw new Error(payload?.error?.message || 'Не удалось выполнить пайплайн промпта.');
  }

  const { source, results } = payload;

  setOutput(els.sourceNoteOutput, source.noteText);
  setOutput(els.transcriptOutput, source.transcriptText);
  setOutput(els.initialPromptOutput, results.initialPrompt);
  setOutput(els.critiqueOutput, formatCritique(results.critique, results.meta));
  setOutput(els.finalPromptOutput, results.finalPrompt);
  setStatus('Пайплайн успешно завершён.', 'success');
}

function resetAll() {
  els.noteText.value = '';
  els.transcriptText.value = '';
  els.audioPreview.removeAttribute('src');
  els.audioPreview.classList.add('hidden');
  recordedBlob = null;
  audioChunks = [];
  resetOutputs();
  setStatus('Форма очищена. Система готова к новой заметке.', 'muted');
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
