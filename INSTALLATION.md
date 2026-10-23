# Installation

Drum Extract can be used in two ways. Pick the one that fits you:

| | CLI only | GUI (Electron app) |
|---|---|---|
| What you get | `drum-extract` command run from a terminal | Desktop window with drag-and-drop, progress bar, and an "Open in VLC" button |
| Needs | Python 3.12+, `uv`, FFmpeg | Everything the CLI needs, **plus** Node.js/npm (and VLC for playback) |
| Good for | Scripting, batch jobs, servers, minimal installs | Interactive one-off use |

The GUI is a thin shell around the CLI, so **the CLI setup is required in both cases**. Do [Part 1](#part-1-cli-installation) first; continue to [Part 2](#part-2-gui-electron-app-installation) only if you want the desktop app.

---

## Common prerequisites

Both paths need:

- **Python 3.12 or newer** and [`uv`](https://docs.astral.sh/uv/)
- **FFmpeg** on your `PATH`, built with the `libmp3lame` encoder (the default Homebrew, apt, and official Windows builds include it)

Verify:

```bash
python3 --version        # 3.12 or newer
uv --version
ffmpeg -hide_banner -encoders | grep libmp3lame
```

If the last command prints nothing, your FFmpeg build lacks the MP3 encoder; reinstall it from your package manager.

> **GPU note.** No extra setup is required. The tool picks CUDA (NVIDIA), then Apple Metal/MPS (Apple Silicon), then CPU automatically, and falls back to CPU if the GPU run fails. On an Apple Silicon Mac a four-minute song takes roughly 20 seconds on MPS versus over a minute on CPU.

---

## Part 1: CLI installation

### 1. Get the code

```bash
git clone <repository-url> drum-extract
cd drum-extract
```

### 2. Install the Python environment

```bash
uv sync
```

This creates `.venv/` with Demucs, PyTorch, and their dependencies. NumPy is pinned below 2.x because the current PyTorch build does not support NumPy 2. The download is large (PyTorch is over 1 GB); it only happens once.

### 3. Run it

```bash
uv run drum-extract song.mp3 --mode drums       # isolated drum stem
uv run drum-extract song.mp3 --mode no-drums    # the mix with drums removed
```

The first run downloads the `htdemucs` model weights (about 80 MB) into your user cache; subsequent runs are offline.

You can also invoke the script directly:

```bash
uv run python CLI/drum_extract.py song.mp3 --mode drums
```

### 4. Verify (optional)

```bash
uv run python -m unittest discover -s tests -v
```

**Done.** If you only want the command line, stop here. See [README.md](README.md#command-line-use) for all CLI options.

---

## Part 2: GUI (Electron app) installation

Complete [Part 1](#part-1-cli-installation) first. The desktop app runs the CLI from the `.venv/` that `uv sync` created; without it the app shows "The Python environment is missing".

### Additional prerequisites

- **Node.js and npm** (any current LTS release)
- **VLC** (optional) to use the **Open result in VLC** button

### 1. Install the Electron dependencies

From the same project directory:

```bash
npm install
```

### 2. Launch the app

```bash
npm start
```

`npm start` runs `electron .`. There is no build step and no separate `dev` script; edit the files under `electron/` and restart to see changes.

### 3. Verify (optional)

```bash
npm run check
```

This syntax-checks the Electron sources.

**Done.** See [README.md](README.md#using-the-desktop-app) for a walkthrough of the window.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| "The Python environment is missing" in the app | Run `uv sync` in the project directory, then restart the app. |
| "Demucs is not installed" from the CLI | You are running a different Python than the one in `.venv/`. Use `uv run drum-extract ...`. |
| "FFmpeg was not found on PATH" | Install FFmpeg and make sure the terminal (or the app, when launched from a terminal) can see it. |
| FFmpeg fails to convert | Check that `ffmpeg -encoders` lists `libmp3lame`. |
| GPU run fails | With `--device auto` the tool retries on CPU automatically. Pass `--device cpu` to skip the GPU entirely. |
| VLC button does nothing | Install VLC. On macOS it must be in `/Applications`. |
