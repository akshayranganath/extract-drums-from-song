import unittest
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from CLI import drum_extract


class DrumExtractTests(unittest.TestCase):
    def test_build_demucs_command_requests_two_stems(self):
        command = drum_extract.build_demucs_command(
            Path("/music/song.mp3"), Path("/tmp/out"), "htdemucs", "mps", "drums"
        )

        self.assertIn("--two-stems=drums", command)
        self.assertIn("htdemucs", command)
        self.assertEqual(command[command.index("-d") : command.index("-d") + 2], ["-d", "mps"])
        self.assertEqual(
            command[command.index("--other-method") : command.index("--other-method") + 2],
            ["--other-method", "none"],
        )
        self.assertIn("/music/song.mp3", command)

    def test_build_demucs_command_keeps_other_stem_method_for_no_drums(self):
        command = drum_extract.build_demucs_command(
            Path("/music/song.mp3"), Path("/tmp/out"), "htdemucs", "cpu", "no-drums"
        )

        self.assertNotIn("--other-method", command)

    def test_resolve_device(self):
        cases = (
            ("auto", True, True, "cuda"),
            ("auto", False, True, "mps"),
            ("auto", False, False, "cpu"),
            ("cpu", True, True, "cpu"),
            ("mps", False, False, "mps"),
        )
        for requested, cuda_available, mps_available, expected in cases:
            with self.subTest(requested=requested, cuda=cuda_available, mps=mps_available):
                self.assertEqual(
                    drum_extract.resolve_device(requested, cuda_available, mps_available),
                    expected,
                )

    def test_run_demucs_retries_on_cpu_and_clears_partial_output(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            partial_file = output_dir / "partial.wav"
            partial_file.write_text("partial")
            results = [SimpleNamespace(returncode=1), SimpleNamespace(returncode=0)]
            with patch(
                "CLI.drum_extract.subprocess.run", side_effect=results
            ) as run:
                returncode = drum_extract.run_demucs(
                    Path("/music/song.mp3"),
                    output_dir,
                    "htdemucs",
                    "drums",
                    "mps",
                    allow_cpu_fallback=True,
                )

            self.assertEqual(returncode, 0)
            self.assertEqual(run.call_count, 2)
            first_command = run.call_args_list[0].args[0]
            second_command = run.call_args_list[1].args[0]
            self.assertEqual(
                first_command[first_command.index("-d") : first_command.index("-d") + 2],
                ["-d", "mps"],
            )
            self.assertEqual(
                second_command[second_command.index("-d") : second_command.index("-d") + 2],
                ["-d", "cpu"],
            )
            self.assertFalse(partial_file.exists())

    def test_run_demucs_does_not_fallback_when_disabled(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            with patch(
                "CLI.drum_extract.subprocess.run",
                return_value=SimpleNamespace(returncode=1),
            ) as run:
                returncode = drum_extract.run_demucs(
                    Path("/music/song.mp3"),
                    Path(temp_dir),
                    "htdemucs",
                    "drums",
                    "mps",
                    allow_cpu_fallback=False,
                )

            self.assertEqual(returncode, 1)
            self.assertEqual(run.call_count, 1)

    def test_build_ffmpeg_command_encodes_mp3(self):
        command = drum_extract.build_ffmpeg_command(
            "/usr/bin/ffmpeg", Path("/tmp/stem.wav"), Path("/tmp/result.mp3")
        )

        self.assertIn("libmp3lame", command)
        self.assertIn("-q:a", command)
        self.assertEqual(command[-1], "/tmp/result.mp3")

    def test_default_output_names(self):
        input_path = Path("/music/song.mp3")

        self.assertEqual(
            drum_extract.default_output_path(input_path, "drums"),
            Path("/music/song_drums.mp3"),
        )
        self.assertEqual(
            drum_extract.default_output_path(input_path, "no-drums"),
            Path("/music/song_no_drums.mp3"),
        )

    def test_find_stem_file(self):
        with self.subTest("finds the matching stem"):
            with patch.object(Path, "rglob", return_value=[Path("/tmp/out/no_drums.wav")]):
                self.assertEqual(
                    drum_extract.find_stem_file(Path("/tmp/out"), "no_drums"),
                    Path("/tmp/out/no_drums.wav"),
                )

        with self.subTest("errors if no matching output exists"):
            with patch.object(Path, "rglob", return_value=[]):
                with self.assertRaises(FileNotFoundError):
                    drum_extract.find_stem_file(Path("/tmp/out"), "drums")


if __name__ == "__main__":
    unittest.main()
