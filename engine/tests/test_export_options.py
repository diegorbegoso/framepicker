"""Export with settings: format, size, quality, LUT and names. Originals are never touched."""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import pytest
from numpy.typing import NDArray
from PIL import Image

from mejores_engine import export_image
from mejores_engine.app import build_dispatcher
from mejores_engine.export_image import DEFAULT_OPTIONS, ExportOptions, target_names, validate
from mejores_engine.rpc import INVALID_PARAMS, NOT_FOUND, RpcError
from mejores_engine.store import Store


def options(**changes: Any) -> dict[str, Any]:
    return {**DEFAULT_OPTIONS, **changes}


def noise(width: int, height: int, seed: int = 1) -> NDArray[np.uint8]:
    rng = np.random.default_rng(seed)
    return rng.integers(0, 256, size=(height, width, 3), dtype=np.uint8)


def identity_cube(tint: float = 1.0) -> str:
    lines = ['TITLE "Tinte"', "LUT_3D_SIZE 3"]
    for b in range(3):
        for g in range(3):
            for r in range(3):
                lines.append(f"{r / 2 * tint} {g / 2 * tint} {b / 2 * tint}")
    return "\n".join(lines) + "\n"


class Session:
    """Two granted folders, JPEGs written with cv2, every photo selected in one burst."""

    def __init__(self, tmp_path: Path, files: dict[str, NDArray[np.uint8]]) -> None:
        self.source = tmp_path / "fuente"
        self.dest = tmp_path / "destino"
        self.source.mkdir()
        self.dest.mkdir()
        for name, image in files.items():
            assert cv2.imwrite(str(self.source / name), image)
        self.data = tmp_path / "data"
        self.dispatcher = build_dispatcher(lambda: Store(self.data))
        self.ok("grant_roots", {"roots": [str(self.source), str(self.dest), str(tmp_path)]})
        scanned = self.ok("scan", {"paths": [str(self.source)]})
        self.session_id = scanned["session_id"]
        with Store(self.data).session() as conn:
            conn.execute(
                "INSERT INTO bursts (id, session_id, position) VALUES ('b', ?, 0)",
                (self.session_id,),
            )
            for position, photo in enumerate(scanned["photos"]):
                conn.execute(
                    "INSERT INTO burst_members (burst_id, photo_id, position) VALUES ('b', ?, ?)",
                    (photo["id"], position),
                )
                conn.execute(
                    "INSERT INTO selections (burst_id, photo_id, source, selected) "
                    "VALUES ('b', ?, 'auto', 1)",
                    (photo["id"],),
                )

    def call(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        reply: dict[str, Any] = json.loads(self.dispatcher.handle_line(line) or "")
        return reply

    def ok(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        reply = self.call(method, params)
        assert "error" not in reply, reply
        return reply["result"]  # type: ignore[no-any-return]

    def export(self, opts: dict[str, Any] | None) -> dict[str, Any]:
        params: dict[str, Any] = {"session_id": self.session_id, "dest": str(self.dest)}
        if opts is not None:
            params["options"] = opts
        job_id = self.ok("export", params)["job_id"]
        deadline = time.monotonic() + 30
        while True:
            status = self.ok("job_status", {"job_id": job_id})
            if status["state"] != "running":
                return status
            assert time.monotonic() < deadline
            time.sleep(0.02)

    def add_lut(self, text: str) -> str:
        path = self.source.parent / "tinte.cube"
        path.write_text(text, encoding="utf-8")
        return str(self.ok("luts_add", {"path": str(path)})["id"])

    def correct(self, **changes: Any) -> None:
        """Store the same corrections on every photo of the session."""
        base = {"exposure": 0, "contrast": 0, "highlights": 0, "shadows": 0, "temperature": 0,
                "tint": 0, "saturation": 0, "lut_id": None, "lut_strength": 1}  # fmt: skip
        with Store(self.data).session() as conn:
            ids = [str(r["id"]) for r in conn.execute("SELECT id FROM photos")]
        self.ok(
            "edits_set",
            {"session_id": self.session_id, "photo_ids": ids, "adjustments": {**base, **changes}},
        )

    def hashes(self) -> dict[str, str]:
        return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in self.source.iterdir()}


def test_without_options_the_export_is_still_a_plain_copy(tmp_path: Path) -> None:
    session = Session(tmp_path, {"IMG_1.jpg": noise(40, 30)})
    status = session.export(None)
    assert (status["state"], status["copied"]) == ("done", 1)
    assert (session.dest / "IMG_1.jpg").read_bytes() == (session.source / "IMG_1.jpg").read_bytes()


def test_default_options_also_copy_the_original_bytes(tmp_path: Path) -> None:
    session = Session(tmp_path, {"IMG_1.jpg": noise(40, 30)})
    session.export(options())
    assert (session.dest / "IMG_1.jpg").read_bytes() == (session.source / "IMG_1.jpg").read_bytes()


@pytest.mark.parametrize(("fmt", "ext", "pil"), [("png", ".png", "PNG"), ("webp", ".webp", "WEBP")])
def test_the_format_changes_the_file(tmp_path: Path, fmt: str, ext: str, pil: str) -> None:
    session = Session(tmp_path, {"IMG_1.jpg": noise(40, 30)})
    status = session.export(options(format=fmt))
    assert status["copied"] == 1
    out = session.dest / f"IMG_1{ext}"
    with Image.open(out) as image:
        assert image.format == pil
        assert image.size == (40, 30)
    assert not list(session.dest.glob("*.part"))


def test_the_long_edge_shrinks_but_never_enlarges(tmp_path: Path) -> None:
    session = Session(tmp_path, {"big.jpg": noise(1200, 800), "small.jpg": noise(400, 300, seed=2)})
    session.export(options(format="jpg", long_edge=600))
    with (
        Image.open(session.dest / "big.jpg") as big,
        Image.open(session.dest / "small.jpg") as small,
    ):
        assert big.size == (600, 400)
        assert small.size == (400, 300)


def test_a_lower_quality_makes_a_smaller_jpeg(tmp_path: Path) -> None:
    session = Session(tmp_path, {"IMG_1.jpg": noise(300, 200)})
    session.export(options(format="jpg", quality=95, name_pattern="alta_{name}"))
    session.export(options(format="jpg", quality=50, name_pattern="baja_{name}"))
    high = (session.dest / "alta_IMG_1.jpg").stat().st_size
    low = (session.dest / "baja_IMG_1.jpg").stat().st_size
    assert low < high


def test_a_lut_is_applied_to_the_exported_pixels(tmp_path: Path) -> None:
    session = Session(tmp_path, {"grey.jpg": np.full((20, 20, 3), 200, dtype=np.uint8)})
    session.correct(lut_id=session.add_lut(identity_cube(tint=0.5)))
    session.export(options(format="png"))
    out = np.asarray(Image.open(session.dest / "grey.png").convert("RGB"))
    assert abs(int(out[5, 5, 0]) - 100) <= 3


def test_corrections_alone_re_encode_and_keep_the_original_untouched(tmp_path: Path) -> None:
    session = Session(tmp_path, {"grey.jpg": np.full((20, 20, 3), 200, dtype=np.uint8)})
    before = session.hashes()
    session.correct(exposure=-1)
    session.export(options())
    assert session.hashes() == before
    out = np.asarray(Image.open(session.dest / "grey.jpg").convert("RGB"))
    assert out[5, 5, 0] < 140  # one stop darker than 200


def test_apply_edits_off_exports_the_photo_as_it_was_shot(tmp_path: Path) -> None:
    session = Session(tmp_path, {"grey.jpg": np.full((20, 20, 3), 200, dtype=np.uint8)})
    session.correct(exposure=-1)
    session.export(options(apply_edits=False))
    assert (session.dest / "grey.jpg").read_bytes() == (session.source / "grey.jpg").read_bytes()


def test_only_the_corrected_photos_are_saved_again_when_the_rest_are_copied(
    tmp_path: Path,
) -> None:
    session = Session(tmp_path, {"A.jpg": noise(40, 30, 1), "B.jpg": noise(40, 30, 2)})
    with Store(session.data).session() as conn:
        rows = conn.execute(
            "SELECT id, path FROM photos WHERE session_id = ?", (session.session_id,)
        ).fetchall()
    first = next(str(r["id"]) for r in rows if str(r["path"]).endswith("A.jpg"))
    session.ok(
        "edits_set",
        {
            "session_id": session.session_id,
            "photo_ids": [first],
            "adjustments": {
                "exposure": 1,
                "contrast": 0,
                "highlights": 0,
                "shadows": 0,
                "temperature": 0,
                "tint": 0,
                "saturation": 0,
                "lut_id": None,
                "lut_strength": 1,
            },  # fmt: skip
        },
    )
    session.export(options())
    assert (session.dest / "B.jpg").read_bytes() == (session.source / "B.jpg").read_bytes()
    assert (session.dest / "A.jpg").read_bytes() != (session.source / "A.jpg").read_bytes()


def test_photo_ids_export_any_photo_not_only_the_chosen(tmp_path: Path) -> None:
    session = Session(tmp_path, {"A.jpg": noise(40, 30, 1), "B.jpg": noise(40, 30, 2)})
    with Store(session.data).session() as conn:
        conn.execute("UPDATE selections SET selected = 0")
        rows = conn.execute("SELECT id, path FROM photos").fetchall()
    only = next(str(r["id"]) for r in rows if str(r["path"]).endswith("B.jpg"))
    base = {"session_id": session.session_id, "dest": str(session.dest)}
    nothing = session.ok("export", base)["job_id"]  # no photo is chosen now
    while session.ok("job_status", {"job_id": nothing})["state"] == "running":
        time.sleep(0.02)
    assert list(session.dest.iterdir()) == []
    job = session.ok("export", {**base, "photo_ids": [only], "options": options()})["job_id"]
    while session.ok("job_status", {"job_id": job})["state"] == "running":
        time.sleep(0.02)
    assert [p.name for p in session.dest.iterdir()] == ["B.jpg"]


def test_names_follow_the_pattern_and_never_overwrite(tmp_path: Path) -> None:
    session = Session(tmp_path, {"A.jpg": noise(30, 30, 1), "B.jpg": noise(30, 30, 2)})
    (session.dest / "boda_001.jpg").write_bytes(b"keep me")
    session.export(options(format="jpg", name_pattern="boda_{n}"))
    assert (session.dest / "boda_001.jpg").read_bytes() == b"keep me"
    assert sorted(p.name for p in session.dest.iterdir()) == [
        "boda_001.jpg",
        "boda_001_1.jpg",
        "boda_002.jpg",
    ]


def test_a_raw_is_developed_in_full_and_saved_as_a_jpeg(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[dict[str, Any]] = []

    class FakeRaw:
        def __enter__(self) -> FakeRaw:
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def postprocess(self, **kwargs: Any) -> NDArray[np.uint8]:
            calls.append(kwargs)
            return np.full((300, 400, 3), 150, dtype=np.uint8)

    monkeypatch.setattr(export_image.rawpy, "imread", lambda _path: FakeRaw())
    session = Session(tmp_path, {})
    (session.source / "shot.ARW").write_bytes(b"raw")
    scanned = session.ok("scan", {"paths": [str(session.source)]})
    photo = scanned["photos"][0]
    with Store(session.data).session() as conn:
        conn.execute(
            "INSERT INTO bursts (id, session_id, position) VALUES ('r', ?, 0)",
            (scanned["session_id"],),
        )
        conn.execute("INSERT INTO burst_members VALUES ('r', ?, 0)", (photo["id"],))
        conn.execute("INSERT INTO selections VALUES ('r', ?, 'auto', 1)", (photo["id"],))
    job = session.ok(
        "export",
        {
            "session_id": scanned["session_id"],
            "dest": str(session.dest),
            "options": options(long_edge=320),
        },
    )["job_id"]
    while session.ok("job_status", {"job_id": job})["state"] == "running":
        time.sleep(0.02)
    with Image.open(session.dest / "shot.jpg") as out:
        assert out.format == "JPEG"
        assert out.size == (320, 240)
    assert calls == [{"use_camera_wb": True, "output_bps": 8}]


def test_a_jpeg_keeps_its_exif_but_not_the_orientation(tmp_path: Path) -> None:
    session = Session(tmp_path, {})
    path = session.source / "IMG_1.jpg"
    exif = Image.Exif()
    exif[271] = "Sony"  # Make
    exif[274] = 6  # Orientation
    Image.fromarray(noise(40, 30)).save(path, exif=exif.tobytes())
    scanned = session.ok("scan", {"paths": [str(session.source)]})
    options_ = ExportOptions(format="jpg", long_edge=0, quality=90)
    target = session.dest / "out.jpg"
    export_image.render_one(path, target, options_, None, None)
    with Image.open(target) as out:
        tags = out.getexif()
        assert tags.get(271) == "Sony"
        assert 274 not in tags
    assert scanned["photos"]


@pytest.mark.parametrize(
    "bad",
    [
        options(format="gif"),
        options(long_edge=100),
        options(long_edge=1.5),
        options(quality=10),
        options(quality=True),
        options(apply_edits="yes"),
        options(name_pattern=""),
        options(name_pattern="fijo"),
        options(name_pattern="a/{name}"),
        options(name_pattern="{name}{otro}"),
        {"format": "jpg"},
    ],
)
def test_bad_options_are_refused(bad: dict[str, Any]) -> None:
    with pytest.raises(RpcError) as caught:
        validate(bad)
    assert caught.value.code == INVALID_PARAMS


def test_the_options_are_a_setting_with_a_default(tmp_path: Path) -> None:
    session = Session(tmp_path, {})
    assert session.ok("settings_get", {})["export_options"] == DEFAULT_OPTIONS
    chosen = options(format="webp", quality=80, long_edge=2048)
    session.ok("settings_set", {"key": "export_options", "value": chosen})
    assert session.ok("settings_get", {})["export_options"] == chosen
    assert session.call("settings_set", {"key": "export_options", "value": {}})["error"][
        "code"
    ] == (INVALID_PARAMS)


def test_unknown_photos_or_bad_options_stop_the_export_before_it_starts(tmp_path: Path) -> None:
    session = Session(tmp_path, {"IMG_1.jpg": noise(40, 30)})
    params = {"session_id": session.session_id, "dest": str(session.dest)}
    missing = session.call("export", {**params, "photo_ids": ["nope"]})
    assert missing["error"]["code"] == NOT_FOUND
    empty = session.call("export", {**params, "photo_ids": []})
    assert empty["error"]["code"] == INVALID_PARAMS
    bad = session.call("export", {**params, "options": options(format="gif")})
    assert bad["error"]["code"] == INVALID_PARAMS
    assert list(session.dest.iterdir()) == []


def test_options_saved_by_an_older_version_are_brought_up_to_date(tmp_path: Path) -> None:
    session = Session(tmp_path, {})
    old = {"format": "jpg", "long_edge": 0, "quality": 80, "lut_id": None, "name_pattern": "{name}"}
    with Store(session.data).session() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('export_options', ?)", (json.dumps(old),)
        )
    got = session.ok("settings_get", {})["export_options"]
    assert got == {**DEFAULT_OPTIONS, "format": "jpg", "quality": 80}
    with Store(session.data).session() as conn:
        conn.execute("UPDATE settings SET value = '123' WHERE key = 'export_options'")
    assert session.ok("settings_get", {})["export_options"] == DEFAULT_OPTIONS


def test_target_names_use_the_extension_of_the_format(tmp_path: Path) -> None:
    photos = [tmp_path / "a.ARW", tmp_path / "b.png", tmp_path / "c.JPG"]
    keep = target_names(photos, tmp_path, ExportOptions())
    assert [t.name for _, t in keep] == ["a.jpg", "b.png", "c.JPG"]
    png = target_names(photos, tmp_path, ExportOptions(format="png"))
    assert {t.suffix for _, t in png} == {".png"}
