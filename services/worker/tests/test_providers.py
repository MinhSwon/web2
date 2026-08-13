from pathlib import Path

from app.providers import write_captions


def test_write_captions(tmp_path: Path) -> None:
    output = tmp_path / "captions.srt"
    write_captions("Cảnh thứ nhất. Cảnh thứ hai.", 6, output)
    content = output.read_text(encoding="utf-8")
    assert "00:00:00,000 --> 00:00:03,000" in content
    assert "Cảnh thứ hai" in content
