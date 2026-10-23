const browseButton = document.getElementById('browseButton');
const dropZone = document.getElementById('dropZone');
const selectedFile = document.getElementById('selectedFile');
const modeSelect = document.getElementById('modeSelect');
const separateButton = document.getElementById('separateButton');
const cancelButton = document.getElementById('cancelButton');
const progressBar = document.getElementById('progressBar');
const percentText = document.getElementById('percentText');
const statusText = document.getElementById('statusText');
const outputText = document.getElementById('outputText');
const errorBox = document.getElementById('errorBox');
const vlcButton = document.getElementById('vlcButton');

// Renderer state is presentation-only; file paths and process control stay in the main process.
let chosenFile = null;
let isBusy = false;

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = !message;
}

function setChosenFile(file) {
  chosenFile = file;
  selectedFile.textContent = file ? file.name : 'No file selected';
  separateButton.disabled = !file || isBusy;
  vlcButton.disabled = true;
  outputText.hidden = true;
  showError('');
  progressBar.value = 0;
  percentText.textContent = '0%';
  statusText.textContent = file ? 'Ready to separate.' : 'Choose an MP3 to begin.';
}

async function chooseAudio() {
  try {
    const file = await window.drumApp.chooseAudio();
    if (file) setChosenFile(file);
  } catch (error) {
    showError(error.message || String(error));
  }
}

browseButton.addEventListener('click', chooseAudio);
dropZone.addEventListener('click', (event) => {
  if (event.target.closest('button')) return;
  chooseAudio();
});
dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('is-dragging');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-dragging'));
// Convert the dropped File to a local path through preload, then validate it in the main process.
dropZone.addEventListener('drop', async (event) => {
  event.preventDefault();
  dropZone.classList.remove('is-dragging');
  const file = event.dataTransfer.files[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.mp3')) {
    showError('Please drop an MP3 audio file. Video files are not supported.');
    return;
  }
  try {
    const filePath = window.drumApp.getPathForFile(file);
    const result = await window.drumApp.registerDroppedAudio(filePath);
    setChosenFile(result);
  } catch (error) {
    showError(error.message || String(error));
  }
});

// Progress arrives from Demucs through the main process and the restricted preload bridge.
window.drumApp.onProgress(({ percent, status }) => {
  progressBar.value = percent;
  percentText.textContent = `${percent}%`;
  statusText.textContent = status;
  if (status === 'Starting Demucs…') {
    cancelButton.hidden = false;
    cancelButton.disabled = false;
  }
});

// The main process shows the save dialog, starts Demucs, and streams progress while we await it.
separateButton.addEventListener('click', async () => {
  if (!chosenFile || isBusy) return;
  isBusy = true;
  separateButton.disabled = true;
  browseButton.disabled = true;
  modeSelect.disabled = true;
  vlcButton.disabled = true;
  cancelButton.hidden = true;
  cancelButton.disabled = true;
  showError('');
  outputText.hidden = true;
  progressBar.value = 2;
  percentText.textContent = '2%';
  statusText.textContent = 'Choose where to save the MP3 file…';

  try {
    const result = await window.drumApp.startSeparation(modeSelect.value);
    if (result.cancelled) {
      statusText.textContent = result.stage === 'separation'
        ? 'Separation cancelled.'
        : 'Save cancelled.';
      progressBar.value = 0;
      percentText.textContent = '0%';
      return;
    }
    if (!result.ok) throw new Error(result.error || 'Separation failed.');

    outputText.textContent = `Saved: ${result.outputPath}`;
    outputText.hidden = false;
    vlcButton.disabled = false;
    statusText.textContent = 'Separation complete.';
    progressBar.value = 100;
    percentText.textContent = '100%';
  } catch (error) {
    statusText.textContent = 'Separation failed.';
    showError(error.message || String(error));
  } finally {
    isBusy = false;
    browseButton.disabled = false;
    modeSelect.disabled = false;
    separateButton.disabled = !chosenFile;
    cancelButton.hidden = true;
    cancelButton.disabled = true;
  }
});

cancelButton.addEventListener('click', async () => {
  cancelButton.disabled = true;
  try {
    await window.drumApp.cancelSeparation();
  } catch (error) {
    showError(error.message || String(error));
  }
});

vlcButton.addEventListener('click', async () => {
  vlcButton.disabled = true;
  showError('');
  try {
    const result = await window.drumApp.openOutputInVlc();
    if (!result.ok) throw new Error(result.error || 'Could not open VLC.');
  } catch (error) {
    showError(error.message || String(error));
  } finally {
    vlcButton.disabled = false;
  }
});
