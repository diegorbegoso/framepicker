"""Automatic basic correction: what it suggests, and running it over groups of bursts."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray

from mejores_engine.adjust import Adjustments, apply
from mejores_engine.app import build_dispatcher
from mejores_engine.autofix import suggest
from mejores_engine.rpc import INVALID_PARAMS, NOT_FOUND, Dispatcher, NullEmitter
from mejores_engine.store import Store


def flat(value: int, size: int = 80) -> NDArray[np.uint8]:
    return np.full((size, size, 3), value, dtype=np.uint8)


def ramp(low: int, high: int, size: int = 80) -> NDArray[np.uint8]:
    """A horizontal ramp between two grey levels: a picture with a known spread of tones."""
    row = np.linspace(low, high, size, dtype=np.uint8)
    return np.dstack([np.tile(row, (size, 1))] * 3)


def test_a_dark_picture_is_lifted_and_a_bright_one_is_brought_down() -> None:
    assert suggest(ramp(20, 90)).exposure > 0.3
    assert suggest(ramp(150, 250)).exposure < -0.3


def test_a_well_exposed_picture_is_left_almost_alone() -> None:
    result = suggest(ramp(30, 215))
    assert abs(result.exposure) < 0.15
    assert result.contrast < 0.1
    assert result.highlights == 0 and result.shadows == 0


def test_a_flat_picture_gets_contrast() -> None:
    assert suggest(ramp(95, 145)).contrast > 0.1
    assert suggest(ramp(0, 255)).contrast == 0


def test_burnt_highlights_come_down_and_deep_shadows_come_up() -> None:
    burnt = ramp(60, 150)
    burnt[:, :20] = 255
    assert suggest(burnt).highlights < -0.1
    deep = ramp(100, 140)
    deep[:, :48] = 6
    assert suggest(deep).shadows > 0.1


def test_a_night_scene_with_bright_lights_is_not_pushed_into_white() -> None:
    night = flat(5, 100)
    night[:3, :] = 255  # a few very bright lights on black
    night[:, :3] = 255
    result = suggest(night)
    assert result.exposure == 0
    lifted = apply(night, Adjustments(exposure=result.exposure, shadows=result.shadows))
    assert float((lifted >= 250).mean()) <= float((night >= 250).mean()) + 0.01


def test_white_balance_is_only_suggested_when_asked_and_cools_a_warm_picture() -> None:
    warm = np.dstack([flat(90), flat(130), flat(170)])[:, :, [0, 1, 2]]
    warm = np.stack([flat(90)[:, :, 0], flat(130)[:, :, 0], flat(170)[:, :, 0]], axis=2)  # BGR
    plain = suggest(warm)
    assert (plain.temperature, plain.tint) == (0, 0)
    balanced = suggest(warm, white_balance=True)
    assert balanced.temperature < -0.1
    cool = np.stack([flat(170)[:, :, 0], flat(130)[:, :, 0], flat(90)[:, :, 0]], axis=2)
    assert suggest(cool, white_balance=True).temperature > 0.1


def test_white_balance_stays_within_its_limits() -> None:
    extreme = np.stack([flat(5)[:, :, 0], flat(60)[:, :, 0], flat(200)[:, :, 0]], axis=2)
    result = suggest(extreme, white_balance=True)
    assert -0.4 <= result.temperature <= 0.4 and -0.3 <= result.tint <= 0.3


def test_the_suggestion_is_stable_when_applied_and_never_touches_the_lut() -> None:
    image = ramp(10, 100)
    first = suggest(image)
    again = suggest(apply(image, first))
    assert abs(again.exposure) < 0.3
    assert first.lut_id is None and first.lut_strength == 1
    assert all(round(v, 2) == v for v in (first.exposure, first.contrast, first.highlights))


def test_a_big_picture_is_judged_on_a_small_copy_with_the_same_result() -> None:
    small = ramp(20, 90, 80)
    big = cv2.resize(small, (3200, 3200), interpolation=cv2.INTER_NEAREST)
    assert abs(suggest(big).exposure - suggest(small).exposure) < 0.05


class Recorder(NullEmitter):
    """Remembers the notifications of the jobs, as the interface would receive them."""

    def __init__(self) -> None:
        super().__init__()
        self.events: list[tuple[str, dict[str, Any]]] = []

    def notify(self, method: str, params: dict[str, Any]) -> None:
        self.events.append((method, params))


class Session:
    """Two bursts: two dark photos (one chosen) and one bright photo, plus one loose photo."""

    def __init__(self, tmp_path: Path) -> None:
        self.folder = tmp_path / "fotos"
        self.folder.mkdir()
        levels = {"a.png": 40, "b.png": 45, "c.png": 215, "d.png": 60}
        for name, level in levels.items():
            assert cv2.imwrite(
                str(self.folder / name), ramp(max(level - 20, 0), min(level + 20, 255))
            )
        self.recorder = Recorder()
        self.dispatcher: Dispatcher = build_dispatcher(
            lambda: Store(tmp_path / "data"), emitter=self.recorder
        )
        self.call("grant_roots", {"roots": [str(self.folder)]})
        scanned = self.call("scan", {"paths": [str(self.folder)]})["result"]
        self.session_id = scanned["session_id"]
        self.ids = {Path(p["path"]).name: p["id"] for p in scanned["photos"]}
        with Store(tmp_path / "data").session() as conn:
            for burst, names in (("b1", ["a.png", "b.png"]), ("b2", ["c.png"])):
                conn.execute(
                    "INSERT INTO bursts (id, session_id, position) VALUES (?, ?, ?)",
                    (burst, self.session_id, int(burst[1]) - 1),
                )
                for position, name in enumerate(names):
                    conn.execute(
                        "INSERT INTO burst_members VALUES (?, ?, ?)",
                        (burst, self.ids[name], position),
                    )
                    chosen = int(name in ("b.png", "c.png"))  # b is the chosen one of its burst
                    conn.execute(
                        "INSERT INTO selections VALUES (?, ?, 'auto', ?)",
                        (burst, self.ids[name], chosen),
                    )
            conn.execute(
                "INSERT INTO scores VALUES (?, 500, 0.9, 0, 0, 0, NULL, 'x', 'now')",
                (self.ids["a.png"],),
            )  # a is sharper than b, but b is chosen

    def call(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        line = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
        reply: dict[str, Any] = json.loads(self.dispatcher.handle_line(line) or "")
        return reply

    def run(self, names: list[str], **extra: Any) -> dict[str, Any]:
        params = {"session_id": self.session_id, "photo_ids": [self.ids[n] for n in names], **extra}
        job = self.call("autofix_run", params)["result"]["job_id"]
        deadline = time.monotonic() + 30
        while True:
            status = self.call("job_status", {"job_id": job})["result"]
            if status["state"] != "running":
                return status
            assert time.monotonic() < deadline
            time.sleep(0.02)

    def stored(self) -> dict[str, dict[str, Any]]:
        edits = self.call("edits_get", {"session_id": self.session_id})["result"]["edits"]
        by_name = {name: edits.get(pid) for name, pid in self.ids.items()}
        return {name: adjustments for name, adjustments in by_name.items() if adjustments}


def test_one_photo_can_be_suggested_without_saving_anything(tmp_path: Path) -> None:
    shoot = Session(tmp_path)
    reply = shoot.call("autofix_suggest", {"photo_id": shoot.ids["a.png"]})["result"]
    assert reply["adjustments"]["exposure"] > 0.2
    assert reply["adjustments"]["lut_id"] is None
    assert shoot.stored() == {}
    with_wb = shoot.call("autofix_suggest", {"photo_id": shoot.ids["a.png"], "white_balance": True})
    assert "adjustments" in with_wb["result"]


def test_suggest_validates_its_input(tmp_path: Path) -> None:
    shoot = Session(tmp_path)
    assert shoot.call("autofix_suggest", {})["error"]["code"] == INVALID_PARAMS
    assert shoot.call("autofix_suggest", {"photo_id": "nope"})["error"]["code"] == NOT_FOUND
    bad = shoot.call("autofix_suggest", {"photo_id": shoot.ids["a.png"], "white_balance": "yes"})
    assert bad["error"]["code"] == INVALID_PARAMS


def test_a_burst_gets_one_correction_from_its_chosen_photo(tmp_path: Path) -> None:
    shoot = Session(tmp_path)
    status = shoot.run(["a.png", "b.png"])
    assert (status["state"], status["failed"], status["fixed"], status["total"]) == (
        "done",
        0,
        2,
        1,
    )
    stored = shoot.stored()
    assert set(stored) == {"a.png", "b.png"}
    assert stored["a.png"] == stored["b.png"]
    assert stored["a.png"]["exposure"] > 0.2  # from b, the chosen one, which is dark


def test_each_burst_gets_its_own_and_loose_photos_their_own(tmp_path: Path) -> None:
    shoot = Session(tmp_path)
    status = shoot.run(["a.png", "b.png", "c.png", "d.png"])
    assert (status["state"], status["fixed"], status["total"]) == ("done", 4, 3)
    stored = shoot.stored()
    assert stored["c.png"]["exposure"] < -0.2  # the bright burst is brought down
    assert stored["a.png"]["exposure"] > 0.2
    assert stored["d.png"]["exposure"] > 0.1  # a photo outside any burst is its own reference


def test_only_the_photos_asked_for_are_changed_but_the_reference_still_comes_from_the_burst(
    tmp_path: Path,
) -> None:
    shoot = Session(tmp_path)
    shoot.run(["a.png"])
    assert set(shoot.stored()) == {"a.png"}


def test_the_lut_and_its_strength_a_photo_already_had_are_kept(tmp_path: Path) -> None:
    shoot = Session(tmp_path)
    with_lut = {
        "exposure": 0, "contrast": 0, "highlights": 0, "shadows": 0, "temperature": 0,
        "tint": 0, "saturation": 0, "lut_id": "mi-look", "lut_strength": 0.4,
    }  # fmt: skip
    shoot.call(
        "edits_set",
        {
            "session_id": shoot.session_id,
            "photo_ids": [shoot.ids["a.png"]],
            "adjustments": with_lut,
        },
    )
    shoot.run(["a.png", "b.png"])
    stored = shoot.stored()
    assert (stored["a.png"]["lut_id"], stored["a.png"]["lut_strength"]) == ("mi-look", 0.4)
    assert stored["b.png"]["lut_id"] is None
    assert stored["a.png"]["exposure"] == stored["b.png"]["exposure"] > 0.2


def test_the_job_reports_its_progress_and_its_end(tmp_path: Path) -> None:
    shoot = Session(tmp_path)
    shoot.run(["a.png", "c.png"])
    kinds = [(m, p["kind"]) for m, p in shoot.recorder.events]
    assert kinds[0] == ("progress", "autofix") and kinds[-1] == ("job_done", "autofix")
    progress = [p for m, p in shoot.recorder.events if m == "progress"]
    assert [p["done"] for p in progress] == [0, 1, 2] and progress[-1]["total"] == 2
    done = shoot.recorder.events[-1][1]
    assert (done["state"], done["fixed"], done["failed"]) == ("done", 2, 0)


def test_a_photo_that_cannot_be_read_is_counted_and_the_rest_carry_on(tmp_path: Path) -> None:
    shoot = Session(tmp_path)
    (shoot.folder / "c.png").write_bytes(b"not an image")
    status = shoot.run(["a.png", "c.png"])
    assert (status["state"], status["failed"], status["fixed"]) == ("done", 1, 1)
    assert status["errors"] and "c.png" in status["errors"][0]["path"]
    assert set(shoot.stored()) == {"a.png"}


def test_a_job_can_be_cancelled(tmp_path: Path, monkeypatch: Any) -> None:
    from mejores_engine import autofix

    shoot = Session(tmp_path)
    real = autofix.correction_for

    def slow(source: Any, white_balance: bool) -> Adjustments:
        time.sleep(0.2)
        return real(source, white_balance)

    monkeypatch.setattr(autofix, "correction_for", slow)
    params = {
        "session_id": shoot.session_id,
        "photo_ids": [shoot.ids[n] for n in ("a.png", "c.png", "d.png")],
    }
    job = shoot.call("autofix_run", params)["result"]["job_id"]
    time.sleep(0.05)
    assert shoot.call("cancel", {"job_id": job})["result"]["state"] in ("cancelled", "running")
    deadline = time.monotonic() + 10
    while shoot.call("job_status", {"job_id": job})["result"]["state"] == "running":
        assert time.monotonic() < deadline
        time.sleep(0.02)
    status = shoot.call("job_status", {"job_id": job})["result"]
    assert status["state"] == "cancelled"
    assert status["done"] < 3


def test_the_run_checks_its_input_and_its_photos(tmp_path: Path) -> None:
    shoot = Session(tmp_path)
    ids = [shoot.ids["a.png"]]
    base = {"session_id": shoot.session_id, "photo_ids": ids}
    assert shoot.call("autofix_run", {**base, "photo_ids": []})["error"]["code"] == INVALID_PARAMS
    assert shoot.call("autofix_run", {**base, "photo_ids": [3]})["error"]["code"] == INVALID_PARAMS
    assert (
        shoot.call("autofix_run", {**base, "white_balance": 1})["error"]["code"] == INVALID_PARAMS
    )
    assert shoot.call("autofix_run", {"photo_ids": ids})["error"]["code"] == INVALID_PARAMS
    assert shoot.call("autofix_run", {**base, "session_id": "nope"})["error"]["code"] == NOT_FOUND
    assert shoot.call("autofix_run", {**base, "photo_ids": ["nope"]})["error"]["code"] == NOT_FOUND
    assert shoot.call("job_status", {"job_id": "nope"})["error"]["code"] == NOT_FOUND


def test_edits_put_restores_many_photos_to_their_own_values_or_to_none(tmp_path: Path) -> None:
    shoot = Session(tmp_path)
    shoot.run(["a.png", "c.png"])
    before = shoot.stored()
    assert set(before) == {"a.png", "c.png"}
    other = {**before["a.png"], "contrast": 0.2}
    reply = shoot.call(
        "edits_put",
        {
            "session_id": shoot.session_id,
            "entries": {shoot.ids["a.png"]: other, shoot.ids["c.png"]: None},
        },
    )
    assert set(reply["result"]["photo_ids"]) == {shoot.ids["a.png"], shoot.ids["c.png"]}
    after = shoot.stored()
    assert set(after) == {"a.png"} and after["a.png"]["contrast"] == 0.2


def test_edits_put_validates(tmp_path: Path) -> None:
    shoot = Session(tmp_path)
    session = {"session_id": shoot.session_id}
    assert shoot.call("edits_put", {**session, "entries": {}})["error"]["code"] == INVALID_PARAMS
    assert shoot.call("edits_put", {**session, "entries": []})["error"]["code"] == INVALID_PARAMS
    bad = shoot.call("edits_put", {**session, "entries": {shoot.ids["a.png"]: {"exposure": 9}}})
    assert bad["error"]["code"] == INVALID_PARAMS
    stray = shoot.call("edits_put", {**session, "entries": {"nope": None}})
    assert stray["error"]["code"] == NOT_FOUND
    assert shoot.stored() == {}
