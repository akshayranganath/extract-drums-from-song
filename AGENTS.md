# Agent Instructions

## Project overview

Drum Extract is a local Electron app backed by a Python CLI. It accepts MP3 input, uses Demucs to produce a temporary WAV stem, uses FFmpeg (`libmp3lame`) to create the final MP3, deletes the temporary WAV/stems, and can open the MP3 in VLC.

## Source map

- `CLI/drum_extract.py`: CLI, Demucs invocation, FFmpeg encoding, and temporary-file cleanup.
- `electron/main.cjs`: native file dialogs, input validation, Python process lifecycle, progress events, and VLC launch.
- `electron/preload.cjs`: narrow IPC bridge. Do not expose raw `ipcRenderer` or Node APIs to the UI.
- `electron/renderer/`: HTML, CSS, and renderer interactions.
- `tests/`: Python unit tests.
- `pyproject.toml` / `uv.lock`: Python dependencies; keep NumPy below 2 for the current PyTorch build.
- `package.json` / `package-lock.json`: Electron dependencies and scripts.

## Setup and checks

```bash
uv sync
npm install
uv run python -m unittest discover -s tests -v
npm run check
```

Start the desktop app with `npm start`. Run the CLI with `uv run drum-extract INPUT.mp3 --mode drums` or `--mode no-drums`.
Use `--device auto|cpu|mps|cuda`; `auto` chooses CUDA, then MPS, then CPU, and retries on CPU if an automatic GPU run fails.

FFmpeg must be on `PATH` and include `libmp3lame`; VLC must be installed to use the play button.

## Invariants and safety

- Keep audio processing local; do not upload user songs.
- Accept MP3 input and produce MP3 output. Keep Demucs WAV stems in a temporary directory and ensure cleanup occurs on both success and failure.
- Only report 100% after the final MP3 has been written. The UI intentionally shows the FFmpeg phase at 97% because this implementation does not calculate encode-duration progress.
- The Cancel button and app quit terminate active processing; CLI temporary stems and incomplete MP3s must still be cleaned up.
- Keep FFmpeg encoding: it is much faster than Demucs' built-in `lameenc` MP3 path.
- Launch Python, FFmpeg, and VLC with `spawn`/`subprocess` argument arrays; never pass file paths through a shell.
- Preserve Electron `contextIsolation`, disabled `nodeIntegration`, and the restricted preload IPC surface.
- Do not overwrite or delete existing audio files while testing. Use temporary synthetic fixtures, and do not commit generated audio or model weights.
- Keep this file and `README.md` in sync with workflow changes. Run the checks above after code changes.
