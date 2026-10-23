#!/usr/bin/env python3
"""Extract the drum stem or the mix without drums from an audio file using Demucs."""

from __future__ import annotations

import argparse
import importlib.util
import signal
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Sequence


# Demucs's two-stem mode emits the requested stem and its complementary mix.
MODE_TO_STEM = {
    "drums": "drums",
    "no-drums": "no_drums",
}


def build_demucs_command(
    input_path: Path, output_dir: Path, model: str, device: str, mode: str
) -> list[str]:
    """Build the Demucs command for a two-stem drums separation."""
    # Run Demucs with this interpreter so it uses the same uv-managed environment.
    command = [
        sys.executable,
        "-m",
        "demucs",
        "--two-stems=drums",
        "-d",
        device,
        "--name",
        model,
        "--out",
        str(output_dir),
        str(input_path),
    ]
    if mode == "drums":
        command.extend(["--other-method", "none"])
    return command


def resolve_device(requested: str, cuda_available: bool, mps_available: bool) -> str:
    """Resolve an explicit device or choose the best available accelerator."""
    if requested != "auto":
        return requested
    if cuda_available:
        return "cuda"
    if mps_available:
        return "mps"
    return "cpu"


def detect_device(requested: str) -> str:
    """Resolve the requested device using the locally installed PyTorch capabilities."""
    try:
        import torch
    except ImportError:
        return "cpu" if requested == "auto" else requested

    return resolve_device(
        requested,
        torch.cuda.is_available(),
        torch.backends.mps.is_available(),
    )


def run_demucs(
    input_path: Path,
    output_dir: Path,
    model: str,
    mode: str,
    device: str,
    allow_cpu_fallback: bool,
) -> int:
    """Run Demucs and optionally retry a failed accelerator run on CPU."""
    def run_on(selected_device: str) -> int:
        print(
            f"Running Demucs model '{model}' on {selected_device} for mode '{mode}'...",
            flush=True,
        )
        command = build_demucs_command(
            input_path, output_dir, model, selected_device, mode
        )
        return subprocess.run(command, check=False).returncode

    returncode = run_on(device)
    if returncode == 0 or not allow_cpu_fallback or device == "cpu":
        return returncode

    for path in output_dir.iterdir():
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        else:
            path.unlink()
    print(f"Demucs failed on {device}; retrying on CPU...", file=sys.stderr, flush=True)
    return run_on("cpu")


def build_ffmpeg_command(ffmpeg_path: str, wav_path: Path, mp3_path: Path) -> list[str]:
    """Build an FFmpeg command that encodes the temporary WAV as a high-quality MP3."""
    return [
        ffmpeg_path,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(wav_path),
        "-vn",
        "-codec:a",
        "libmp3lame",
        "-q:a",
        "2",
        str(mp3_path),
    ]


def default_output_path(input_path: Path, mode: str) -> Path:
    """Return a descriptive MP3 path beside the input file."""
    return input_path.with_name(f"{input_path.stem}_{mode.replace('-', '_')}.mp3")


def find_stem_file(output_dir: Path, stem_name: str) -> Path:
    """Find the requested WAV emitted by Demucs."""
    # Demucs nests stems under model and track directories, so search recursively.
    matches = list(output_dir.rglob(f"{stem_name}.wav"))
    if len(matches) != 1:
        raise FileNotFoundError(
            f"Expected one {stem_name}.wav output from Demucs, found {len(matches)}."
        )
    return matches[0]


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract drums or create a mix without drums using Demucs."
    )
    parser.add_argument("input", type=Path, help="Input audio file, such as an MP3")
    parser.add_argument(
        "--mode",
        choices=tuple(MODE_TO_STEM),
        required=True,
        help="Output the isolated drums or the mix with drums removed",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Output MP3 path (default: <input>_<mode>.mp3 beside the input)",
    )
    parser.add_argument(
        "--model",
        default="htdemucs",
        help="Demucs model name (default: htdemucs; htdemucs_ft is slower)",
    )
    parser.add_argument(
        "--device",
        choices=("auto", "cpu", "mps", "cuda"),
        default="auto",
        help="Demucs device (default: auto; chooses CUDA, then MPS, then CPU)",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace the output file if it already exists",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    def terminate(_signum, _frame):
        raise SystemExit(130)

    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, terminate)
    if hasattr(signal, "SIGINT"):
        signal.signal(signal.SIGINT, terminate)

    args = parse_args(argv)
    input_path = args.input.expanduser().resolve()

    if not input_path.is_file():
        print(f"Error: input file does not exist or is not a file: {input_path}", file=sys.stderr)
        return 2
    if input_path.suffix.lower() != ".mp3":
        print("Error: input must be an MP3 file. This app does not accept video files.", file=sys.stderr)
        return 2

    output_path = (args.output or default_output_path(input_path, args.mode)).expanduser().resolve()
    if output_path.suffix.lower() != ".mp3":
        print("Error: output must be an .mp3 file.", file=sys.stderr)
        return 2
    if output_path == input_path:
        print("Error: output path must not overwrite the input file.", file=sys.stderr)
        return 2
    if output_path.exists() and not args.overwrite:
        print(
            f"Error: output already exists: {output_path}\n"
            "Pass --overwrite to replace it.",
            file=sys.stderr,
        )
        return 2

    if importlib.util.find_spec("demucs") is None:
        print(
            f"Error: Demucs is not installed for {sys.executable}.\n"
            f"Install it with: {sys.executable} -m pip install -U demucs",
            file=sys.stderr,
        )
        return 2

    ffmpeg_path = shutil.which("ffmpeg")
    if ffmpeg_path is None:
        print("Error: FFmpeg was not found on PATH. Install FFmpeg and try again.", file=sys.stderr)
        return 2

    stem_name = MODE_TO_STEM[args.mode]
    temporary_mp3: Path | None = None

    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        # Demucs writes all stems here; temporary WAVs are removed when this directory closes.
        with tempfile.TemporaryDirectory(prefix="drum-extract-") as temp_dir:
            demucs_output_dir = Path(temp_dir)
            device = detect_device(args.device)
            # Inherit the CLI streams so Electron can read Demucs progress and errors.
            returncode = run_demucs(
                input_path,
                demucs_output_dir,
                args.model,
                args.mode,
                device,
                allow_cpu_fallback=args.device == "auto",
            )
            if returncode != 0:
                return returncode

            stem_file = find_stem_file(demucs_output_dir, stem_name)
            # Encode beside the destination, then atomically move the completed MP3 into place.
            with tempfile.NamedTemporaryFile(
                prefix=".drum-extract-", suffix=".mp3", dir=output_path.parent, delete=False
            ) as temp_file:
                temporary_mp3 = Path(temp_file.name)

            print("Converting temporary WAV to MP3 with FFmpeg...", flush=True)
            ffmpeg_command = build_ffmpeg_command(ffmpeg_path, stem_file, temporary_mp3)
            conversion = subprocess.run(ffmpeg_command, check=False)
            if conversion.returncode != 0:
                print("Error: FFmpeg failed to convert the WAV to MP3.", file=sys.stderr)
                return conversion.returncode
            if temporary_mp3.stat().st_size == 0:
                raise RuntimeError("FFmpeg finished without writing an MP3 file.")

            # The selected WAV is no longer needed after a successful encode.
            stem_file.unlink()
            if output_path.exists() and not args.overwrite:
                raise FileExistsError(f"Output appeared during processing: {output_path}")
            temporary_mp3.replace(output_path)
            temporary_mp3 = None
    except FileNotFoundError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except OSError as exc:
        print(f"Error: could not run Demucs/FFmpeg or write output: {exc}", file=sys.stderr)
        return 1
    except RuntimeError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    finally:
        # If FFmpeg fails, discard its partial MP3; the temporary WAV is also cleaned up.
        if temporary_mp3 is not None:
            temporary_mp3.unlink(missing_ok=True)

    print(f"Saved: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
