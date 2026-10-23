# Drum Extract

Separate the drums from an MP3, or remove them, entirely on your machine. Drum Extract runs [Demucs](https://github.com/facebookresearch/demucs) to split the track, then uses FFmpeg to encode the result as an MP3. Nothing is uploaded.

It can be used two ways:

- **Command line** — a `drum-extract` command backed by Python.
- **Desktop app** — an Electron window with drag-and-drop, a progress bar, and one-click playback in VLC. The app is a thin shell around the same CLI.

![Initial Drum Extract window](docs/screenshots/01-start.png)

## Installation

See **[INSTALLATION.md](INSTALLATION.md)**. It covers the shared prerequisites, the CLI-only setup, and the extra steps for the desktop app.

Quick version, once Python 3.12+, `uv`, and FFmpeg are installed:

```bash
uv sync                                        # CLI (required for both)
uv run drum-extract song.mp3 --mode drums

npm install && npm start                       # desktop app (optional)
```

## Command-line use

```bash
uv run drum-extract song.mp3 --mode drums       # isolated drum stem  -> song_drums.mp3
uv run drum-extract song.mp3 --mode no-drums    # mix without drums   -> song_no_drums.mp3
```

| Option | Description |
|---|---|
| `--mode drums` / `--mode no-drums` | Required. Keep only the drums, or everything except the drums. |
| `--output PATH.mp3` | Where to write the result. Default: `<input>_<mode>.mp3` beside the input. |
| `--overwrite` | Replace the output file if it already exists. |
| `--device auto\|cpu\|mps\|cuda` | Default `auto` picks CUDA, then Apple MPS, then CPU, and retries on CPU if the GPU run fails. An explicitly chosen device is not retried. |
| `--model NAME` | Demucs model. Default `htdemucs`; `htdemucs_ft` is slower but slightly better. |

Input must be an `.mp3` file; output is always an `.mp3`. The first run downloads the model weights.

## Using the desktop app

Launch with `npm start`, then:

1. **Pick a song.** Drag an MP3 onto the drop zone, or click **Choose MP3**. Only `.mp3` files are accepted.
2. **Choose what to keep.** Select **Drums only** or **Everything except drums**.
3. **Separate.** Click **Separate audio**. A save dialog opens, pre-filled with `<song>_drums.mp3` or `<song>_no_drums.mp3` beside the input. Cancelling the dialog aborts without processing.
4. **Wait.** The progress bar follows Demucs, holds at 97% while FFmpeg encodes, and reaches 100% only once the MP3 is written. **Cancel** stops the run; nothing is written when you cancel.
5. **Listen.** Click **Open result in VLC**.

![MP3 selected and ready to separate](docs/screenshots/02-file-selected.png)

*An MP3 is selected and ready to process.*

![Separation in progress](docs/screenshots/03-separating.png)

*Demucs is running; the Cancel button is available.*

![Separation complete](docs/screenshots/04-complete.png)

*The completed MP3 can be opened in VLC.*

The app always uses `--device auto`. On an Apple Silicon Mac a four-minute song takes roughly 20 seconds on MPS versus over a minute on CPU.

On macOS, closing the window leaves the app in the Dock; press Cmd+Q (or stop `npm start`) to quit. On Windows and Linux, closing the window quits. Quitting mid-run terminates the backend and cleans up its temporary files.

## How it works

1. Demucs (`--two-stems=drums`) writes WAV stems to a temporary directory.
2. FFmpeg encodes the selected stem to MP3 with `libmp3lame` (much faster than Demucs' built-in `lameenc` path).
3. The MP3 is moved atomically into place; the temporary WAVs, unused stems, and any partial output are deleted on both success and failure.

Source separation is approximate and may leave drum bleed or other artifacts.

## Project layout

```text
CLI/                  Python command-line backend (drum_extract.py)
electron/             Electron main process, preload bridge, and renderer UI
tests/                Python unit tests
docs/screenshots/     README images
INSTALLATION.md       Setup instructions for the CLI and the desktop app
AGENTS.md             Instructions for coding agents
pyproject.toml        Python project and uv dependencies
package.json          Electron scripts and dependencies
```

## Development checks

```bash
uv run python -m unittest discover -s tests -v
npm run check
```
