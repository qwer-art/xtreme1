"""Live HTTP smoke test on scene-0061; annotations only locate the test click."""

import json
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

import numpy as np
from scipy.spatial.transform import Rotation

PUBLIC = Path(__file__).resolve().parents[1] / "public"
TABLES = Path("/home/jerett/datasets/locomotion/nuscenes/v1.0-mini/v1.0-mini")
HTTP = build_opener(ProxyHandler({}))


def call(path, body=None):
    data = None if body is None else json.dumps(body, allow_nan=False).encode()
    req = Request(
        "http://127.0.0.1:3211" + path,
        data=data,
        headers={"Content-Type": "application/json"},
    )
    with HTTP.open(req, timeout=180) as response:
        return json.load(response)


def table(name):
    return json.loads((TABLES / f"{name}.json").read_text())


def main():
    print(call("/status"), flush=True)
    scene = json.loads((PUBLIC / "local-scene/index.json").read_text())
    assert scene["scene"] == "scene-0061"
    scan = next(row for row in scene["scans"] if row["keyframe"])
    raw = (
        (PUBLIC / scan["pointsUrl"].lstrip("/"))
        .read_bytes()
        .split(b"DATA binary\n", 1)[1]
    )
    points = np.frombuffer(raw, "<f4").reshape(-1, 4)[:, :3]
    transform = np.array(scan["worldFromLidar"]).reshape(4, 4).T
    world = points @ transform[:3, :3].T + transform[:3, 3]
    categories = {row["token"]: row["name"] for row in table("category")}
    instances = {
        row["token"]: categories[row["category_token"]] for row in table("instance")
    }
    vehicle = max(
        (
            row
            for row in table("sample_annotation")
            if row["sample_token"] == scan["sampleToken"]
            and instances[row["instance_token"]] == "vehicle.car"
        ),
        key=lambda row: row["num_lidar_pts"],
    )
    rotation = Rotation.from_quat(np.roll(vehicle["rotation"], -1))
    local = rotation.inv().apply(world - vehicle["translation"])
    inside = (np.abs(local) <= np.array(vehicle["size"])[[1, 0, 2]] / 2).all(axis=1)
    candidates = np.flatnonzero(inside)
    click = int(candidates[np.linalg.norm(local[candidates], axis=1).argmin()])
    body = dict(
        scan_id=scan["id"],
        category="car",
        points=points.tolist(),
        prompts=[dict(index=click, positive=True)],
    )
    try:
        call("/segment", {**body, "prompts": [dict(index=len(points), positive=False)]})
    except HTTPError as error:
        assert error.code == 422 and "index" in json.load(error)["error"]
    else:
        raise AssertionError("invalid prompt accepted")
    result = call("/segment", body)
    indices = np.array(result["indices"])
    assert indices.dtype.kind == "i" and len(indices) and np.all(np.diff(indices) > 0)
    assert indices.min() >= 0 and indices.max() < len(points)
    centered = points[indices] - result["center"]
    yaw = result["yaw"]
    axes = np.array([[np.cos(yaw), -np.sin(yaw)], [np.sin(yaw), np.cos(yaw)]])
    centered[:, :2] = centered[:, :2] @ axes
    assert np.all(np.abs(centered) <= np.array(result["size"]) / 2 + 1e-5)
    assert np.isfinite(result["elapsed_ms"]) and result["elapsed_ms"] > 0
    print(
        dict(
            scan=scan["id"],
            points=len(points),
            click=click,
            click_selected=click in indices,
            selected=len(indices),
            in_reference_box=int(inside[indices].sum()),
            reference_box_points=len(candidates),
            **{key: result[key] for key in ("center", "size", "yaw", "elapsed_ms")},
        )
    )


if __name__ == "__main__":
    main()
