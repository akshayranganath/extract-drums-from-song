const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = app.getAppPath();
let mainWindow;
// Keep selected paths in the main process; the renderer only receives display names.
let selectedInputPath = null;
let lastOutputPath = null;
let activeChild = null;
let cancelRequested = false;

function sendProgress(percent, status) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('separation:progress', { percent, status });
  }
}

// Revalidate paths at the IPC boundary instead of trusting renderer input.
async function validateMp3Path(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new Error('Choose an MP3 file from your computer.');
  }
  if (path.extname(filePath).toLowerCase() !== '.mp3') {
    throw new Error('Please choose an MP3 audio file. Video files are not supported.');
  }
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) {
    throw new Error('The selected path is not a file.');
  }
  return path.resolve(filePath);
}

function pythonExecutable() {
  return process.platform === 'win32'
    ? path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(projectRoot, '.venv', 'bin', 'python');
}

function parseProgressText(text, state) {
  // Demucs writes tqdm percentages to stdout/stderr; retain a short tail for parsing/errors.
  state.output = `${state.output}${text}`.slice(-6000);
  if (text.includes('retrying on CPU')) {
    state.percent = 4;
    sendProgress(4, 'GPU run failed; retrying on CPU…');
    return;
  }
  // FFmpeg has no duration-based progress here: hold at 97% during encode and reserve 100% for success.
  if (state.convertingMp3 || text.includes('Converting temporary WAV to MP3')) {
    state.convertingMp3 = true;
    state.percent = Math.max(state.percent, 97);
    sendProgress(state.percent, 'Converting WAV to MP3…');
    return;
  }
  const matches = [...state.output.matchAll(/(\d{1,3})%/g)];
  if (matches.length === 0) {
    if (text.includes('Separating track')) {
      sendProgress(Math.max(state.percent, 4), 'Reading audio and preparing the model…');
    } else if (text.includes('Selected model')) {
      sendProgress(Math.max(state.percent, 3), 'Model loaded; preparing audio…');
    }
    return;
  }

  const modelPercent = Number(matches[matches.length - 1][1]);
  // Reserve the final few percent for writing the result and report 100% only
  // after Demucs exits successfully.
  const percent = Math.min(96, Math.max(4, Math.round(4 + modelPercent * 0.92)));
  state.percent = Math.max(state.percent, percent);
  sendProgress(state.percent, `Separating audio… ${modelPercent}%`);
}

function runSeparation(inputPath, outputPath, mode) {
  cancelRequested = false;
  return new Promise((resolve, reject) => {
    const python = pythonExecutable();
    const script = path.join(projectRoot, 'CLI', 'drum_extract.py');
    // Pass paths as separate arguments, not through a shell, so spaces stay safe.
    const args = [script, inputPath, '--mode', mode, '--output', outputPath, '--overwrite'];
    const child = spawn(python, args, {
      cwd: projectRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const progressState = { output: '', percent: 2, convertingMp3: false };
    activeChild = child;

    // Pipe both streams: progress is on stderr, while the wrapper may print status on stdout.
    const onOutput = (chunk) => parseProgressText(chunk.toString('utf8'), progressState);
    child.stdout.on('data', onOutput);
    child.stderr.on('data', onOutput);
    child.once('error', (error) => {
      activeChild = null;
      reject(new Error(`Could not start Python. Run “uv sync” in the project first. ${error.message}`));
    });
    child.once('close', (code, signal) => {
      activeChild = null;
      const wasCancelled = cancelRequested;
      cancelRequested = false;
      if (wasCancelled) {
        const error = new Error('Separation cancelled.');
        error.cancelled = true;
        reject(error);
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      const detail = progressState.output.trim().slice(-3000);
      reject(new Error(detail || `Demucs stopped with exit code ${code ?? signal ?? 'unknown'}.`));
    });
    sendProgress(2, 'Starting Demucs…');
  });
}

ipcMain.handle('separation:cancel', () => {
  if (!activeChild) return { ok: false };
  cancelRequested = true;
  activeChild.kill('SIGTERM');
  return { ok: true };
});

ipcMain.handle('audio:choose', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose an MP3 file',
    properties: ['openFile'],
    filters: [{ name: 'MP3 audio', extensions: ['mp3'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  selectedInputPath = await validateMp3Path(result.filePaths[0]);
  lastOutputPath = null;
  return { path: selectedInputPath, name: path.basename(selectedInputPath) };
});

ipcMain.handle('audio:register-drop', async (_event, filePath) => {
  selectedInputPath = await validateMp3Path(filePath);
  lastOutputPath = null;
  return { path: selectedInputPath, name: path.basename(selectedInputPath) };
});

ipcMain.handle('separation:start', async (_event, mode) => {
  if (!['drums', 'no-drums'].includes(mode)) {
    return { ok: false, error: 'Choose either “Drums only” or “Without drums”.' };
  }
  if (activeChild) return { ok: false, error: 'A separation is already running.' };
  if (!selectedInputPath) return { ok: false, error: 'Choose an MP3 file first.' };

  const python = pythonExecutable();
  if (!fs.existsSync(python)) {
    return { ok: false, error: 'The Python environment is missing. Run “uv sync” in the project folder, then restart the app.' };
  }

  // Ask for the destination first; the native save dialog also handles overwrite confirmation.
  const inputName = path.basename(selectedInputPath, path.extname(selectedInputPath));
  const suffix = mode === 'drums' ? 'drums' : 'no_drums';
  const suggestedPath = path.join(path.dirname(selectedInputPath), `${inputName}_${suffix}.mp3`);
  const saveResult = await dialog.showSaveDialog(mainWindow, {
    title: 'Save separated audio',
    defaultPath: suggestedPath,
    filters: [{ name: 'MP3 audio', extensions: ['mp3'] }],
  });
  if (saveResult.canceled || !saveResult.filePath) {
    return { cancelled: true, stage: 'save' };
  }

  const outputPath = path.extname(saveResult.filePath).toLowerCase() === '.mp3'
    ? saveResult.filePath
    : `${saveResult.filePath}.mp3`;

  try {
    await runSeparation(selectedInputPath, outputPath, mode);
    lastOutputPath = outputPath;
    sendProgress(100, 'Separation complete.');
    return { ok: true, outputPath, outputName: path.basename(outputPath) };
  } catch (error) {
    lastOutputPath = null;
    if (error.cancelled) {
      sendProgress(0, 'Separation cancelled.');
      return { cancelled: true, stage: 'separation' };
    }
    sendProgress(0, 'Separation failed.');
    return { ok: false, error: error.message };
  }
});

function launchDetached(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', (error) => reject(new Error(`Could not launch VLC: ${error.message}`)));
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

// Launch VLC through the platform's normal executable/launcher without invoking a shell.
async function openWithVlc(filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('The separated MP3 file is no longer available.');

  if (process.platform === 'darwin') {
    return new Promise((resolve, reject) => {
      const child = spawn('open', ['-a', 'VLC', filePath], { stdio: 'ignore' });
      child.once('error', (error) => reject(new Error(`Could not launch VLC: ${error.message}`)));
      child.once('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error('VLC could not be opened. Make sure VLC is installed.'));
      });
    });
  }

  if (process.platform === 'win32') {
    const candidates = [
      path.join(process.env.ProgramFiles || '', 'VideoLAN', 'VLC', 'vlc.exe'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'VideoLAN', 'VLC', 'vlc.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'VideoLAN', 'VLC', 'vlc.exe'),
    ].filter((candidate) => candidate !== path.join('', 'VideoLAN', 'VLC', 'vlc.exe'));
    const executable = candidates.find((candidate) => fs.existsSync(candidate)) || 'vlc.exe';
    return launchDetached(executable, [filePath]);
  }

  return launchDetached('vlc', [filePath]);
}

ipcMain.handle('player:open-output', async () => {
  if (!lastOutputPath) return { ok: false, error: 'Separate a track first.' };
  try {
    await openWithVlc(lastOutputPath);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 760,
    minWidth: 600,
    minHeight: 640,
    title: 'Drum Extract',
    backgroundColor: '#11131a',
    webPreferences: {
      // Keep Node APIs out of page code; expose only the specific operations in preload.
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (activeChild) {
    cancelRequested = true;
    activeChild.kill('SIGTERM');
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
