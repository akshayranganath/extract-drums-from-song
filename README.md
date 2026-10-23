# Drum Extract

A local desktop app for separating drums from MP3 files. Electron provides the interface; the Python CLI in `CLI/` runs Demucs, then FFmpeg converts the selected WAV stem to an MP3. The WAV stem and other intermediate Demucs stems are temporary and cleaned up; VLC opens the final MP3.

## Project layout

```text
CLI/                  Python command-line backend
  drum_extract.py
  __init__.py
electron/              Electron main process, preload bridge, and renderer UI
tests/                 Python unit tests
AGENTS.md              Canonical instructions for coding agents
pyproject.toml         Python project and uv dependencies
package.json           Electron scripts and dependencies
```

## Requirements

- Python 3.12 or newer and `uv`
- Node.js and npm
- FFmpeg installed and available on `PATH`, with the `libmp3lame` encoder
- VLC installed to play the result in VLC

## Set up and launch

From the project directory:

```bash
uv sync
npm install
npm start
```

Drop an MP3 into the app or click **Choose MP3**, select the desired output, click **Separate audio**, and choose where to save the MP3. The progress bar follows Demucs inference and then shows the FFmpeg encoding step. It reaches 100% only after the final MP3 has been written. Click **Open result in VLC** after it completes.

The audio is processed locally and is not uploaded. Demucs downloads its pretrained model on first use. The **Cancel** button stops an active separation, and quitting the app sends a termination signal to the processing process. The temporary WAV, unused Demucs stems, and any failed partial MP3 are cleaned up; only a successfully converted MP3 is kept.

FFmpeg is used to encode the WAV stem because it is much faster than Demucs' built-in `lameenc` MP3 path.

## Command-line use

```bash
uv run drum-extract song.mp3 --mode drums
uv run drum-extract song.mp3 --mode no-drums
uv run drum-extract song.mp3 --mode drums --device auto
```

Or invoke the module directly:

```bash
uv run python CLI/drum_extract.py song.mp3 --mode drums
```

`--device` accepts `auto`, `cpu`, `mps`, or `cuda`; `auto` chooses CUDA, then MPS, then CPU, and retries on CPU if an automatic GPU run fails. An explicitly selected device is not retried. Use `--output path/to/result.mp3` to select an output path and `--overwrite` to replace an existing MP3. Use `--model htdemucs_ft` to try the slower fine-tuned model.

## Checks

```bash
uv run python -m unittest discover -s tests -v
npm run check
```

Source separation is approximate and may leave drum bleed or other artifacts. NumPy is constrained below version 2 because the installed PyTorch build is not compatible with NumPy 2.x.
