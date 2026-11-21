"""Rebuild scene-0061 from nuScenes LiDAR only (no annotation tables).

From frontend/pc-tool:
    run_cp() { env -u PYTHONPATH PYTHONDONTWRITEBYTECODE=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 ~/anaconda3/envs/point_pillar/bin/python scripts/build-centerpoint.py "$@"; }
    run_cp --first
    run_cp --build

Sources: OpenMMLab MMDetection3D nuScenes 0.2m pillar/circle-NMS model zoo
(URL below); local Fast-BEV ac3475c10fba334ff58e5ad1bd72b559d735da97;
tianweiy/CenterPoint 3cf7d870537e287c99b43b68636ea392a5e6f519, PubTracker.
Global XY/velocity for association; output in each scan's LiDAR coordinates,
geometric center and length/width/height in meters, CCW yaw from +X in radians.
Export every post-NMS detection; unsupported tracking classes have a null trackId.
"""

import argparse
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

ASSETS = Path(__file__).resolve().parents[1] / "public/local-scene"
DEFAULT_ROOT = Path.home() / "datasets/locomotion/nuscenes/v1.0-mini"
SCENE = "scene-0061"
CONFIG = "centerpoint_02pillar_second_secfpn_circlenms_4x8_cyclic_20e_nus"
WEIGHT = CONFIG + "_20201004_170716-a134a233.pth"
URL = f"https://download.openmmlab.com/mmdetection3d/v0.1.0_models/centerpoint/{CONFIG}/{WEIGHT}"
CACHE = Path.home() / "datasets/weights/centerpoint"


def checkpoint(cache):
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / WEIGHT
    temp = target.with_suffix(".part")
    source = target if target.exists() else temp
    if source == temp:
        subprocess.run(
            [
                "curl",
                "-fL",
                "--retry",
                "2",
                "--connect-timeout",
                "10",
                "--max-time",
                "180",
                "-C",
                "-",
                "-o",
                str(temp),
                URL,
            ],
            check=True,
        )
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest != "a134a233fd50ba13ccc85ed1aaca9943d3c9781591666949381a232761ff1476":
        raise ValueError(f"Bad checkpoint: {source}, SHA256={digest}")
    if source == temp:
        temp.replace(target)
    print(f"checkpoint={target} sha256={digest}", flush=True)
    return target


def read(path):
    with path.open() as handle:
        return json.load(handle)


def sequence(root):
    from nuscenes.utils.splits import create_splits_scenes

    metadata = root / "v1.0-mini"
    (scene,) = (item for item in read(metadata / "scene.json") if item["name"] == SCENE)
    samples = {item["token"]: item for item in read(metadata / "sample.json")}
    manifest = read(ASSETS / "index.json")
    scans = [scan for scan in manifest["scans"] if scan["keyframe"]]
    lidar = {item["token"]: item for item in read(metadata / "sample_data.json")}
    token = scene["first_sample_token"]
    assert manifest["scene"] == SCENE and len(scans) == scene["nbr_samples"] == 39
    for scan in scans:
        sample = samples[token]
        record = lidar[scan["id"]]
        assert record["is_key_frame"] and record["filename"].startswith(
            "samples/LIDAR_TOP/"
        )
        assert (
            sample["scene_token"] == scene["token"]
            and scan["sampleToken"] == record["sample_token"] == token
        )
        assert (
            scan["timestamp"] == record["timestamp"]
            and (root / record["filename"]).is_file()
        )
        token = sample["next"]
    assert not token and scans[-1]["sampleToken"] == scene["last_sample_token"]
    splits = [name for name, names in create_splits_scenes().items() if SCENE in names]
    print(f"{SCENE} {scene['token']} split={splits} frames={len(scans)}", flush=True)
    print(
        f"first={scans[0]['sampleToken']} lidar={scans[0]['id']} last={scans[-1]['sampleToken']}",
        flush=True,
    )
    return scans, lidar


def transform(record):
    from pyquaternion import Quaternion

    matrix = Quaternion(record["rotation"]).transformation_matrix
    matrix[:3, 3] = record["translation"]
    return matrix


def infer(model, pipeline, root, record, sweeps):
    import torch
    from mmcv.parallel import collate, scatter
    from mmdet3d.core.bbox import get_box_type
    from mmdet3d.datasets.nuscenes_dataset import output_to_nusc_box

    box_type, box_mode = get_box_type("LiDAR")
    data = dict(
        pts_filename=str(root / record["filename"]),
        sweeps=sweeps,
        timestamp=record["timestamp"] / 1e6,
        box_type_3d=box_type,
        box_mode_3d=box_mode,
        img_fields=[],
        bbox3d_fields=[],
        pts_mask_fields=[],
        pts_seg_fields=[],
        bbox_fields=[],
        mask_fields=[],
        seg_fields=[],
    )
    batch = scatter(collate([pipeline(data)], samples_per_gpu=1), [0])[0]
    with torch.no_grad():
        pred = model(return_loss=False, rescale=True, **batch)[0]["pts_bbox"]
    return output_to_nusc_box(
        pred,
        sequential=False,
        n_times=1,
        info={},
        speed_mode="",
        min_interval=0,
        max_interval=0,
        test_adj=None,
        test_time_id=0,
        fix_direction=False,
        test_adj_ids=None,
        verbose=False,
    )


def boxes_for_tracker(boxes, world, classes):
    entries = []
    for box in boxes:
        name = classes[box.label]
        width, length, height = box.wlh.tolist()
        heading = box.orientation.rotation_matrix[:, 0]
        yaw = float(np.arctan2(heading[1], heading[0]))
        center = box.center.tolist()
        np.testing.assert_allclose(
            box.corners()[:, :4].mean(axis=1),
            box.center + 0.5 * length * heading,
            atol=1e-5,
        )
        assert min(length, width, height) > 0 and 0 <= box.score <= 1
        entries.append(
            dict(
                detection_name=name,
                translation=(world @ [*center, 1])[:3],
                velocity=world[:3, :3] @ box.velocity,
                row=dict(
                    category=name.title().replace("_", ""),
                    velocityWorldXY=(world[:3, :3] @ box.velocity)[:2].tolist(),
                    center=center,
                    size=[length, width, height],
                    yaw=yaw,
                    score=float(box.score),
                ),
            )
        )
    return sorted(
        entries, key=lambda entry: (-entry["row"]["score"], *entry["row"]["center"])
    )


def verify_first(rows, cloud):
    points = np.fromfile(cloud, dtype="<f4").reshape(-1, 5)[:, :3]
    for category in ("Car", "Pedestrian"):
        row = max(
            (item for item in rows if item["category"] == category),
            key=lambda item: item["score"],
        )
        axis = np.array([np.cos(row["yaw"]), np.sin(row["yaw"])])
        delta = points - row["center"]
        local = np.column_stack(
            (delta[:, :2] @ axis, delta[:, :2] @ [-axis[1], axis[0]], delta[:, 2])
        )
        hits = int(np.all(np.abs(local) <= np.array(row["size"]) / 2, axis=1).sum())
        if hits < 1:
            raise ValueError(f"No first-scan returns inside top {category}: {row}")
        print(f"first-scan hits={hits} frontXY={axis.tolist()} {row}", flush=True)


def generate(args):
    import mmdet3d
    import torch
    from mmdet3d.apis import init_model
    from mmdet3d.datasets.pipelines import Compose

    sys.path.insert(0, str(args.tracker / "tools/nusc_tracking"))
    from pub_tracker import NUSCENES_TRACKING_NAMES, PubTracker

    scans, lidar = sequence(args.root)
    metadata = args.root / "v1.0-mini"

    def poses(name):
        return {
            item["token"]: transform(item) for item in read(metadata / (name + ".json"))
        }

    ego, calibration = poses("ego_pose"), poses("calibrated_sensor")

    def world_from(record):
        return (
            ego[record["ego_pose_token"]]
            @ calibration[record["calibrated_sensor_token"]]
        )

    assert (
        torch.cuda.is_available()
    ), "CUDA inference requires the existing point_pillar environment"
    config = (
        Path(mmdet3d.__file__).resolve().parents[1]
        / "configs/centerpoint"
        / (CONFIG + ".py")
    )
    print(
        f"config={config} torch={torch.__version__} gpu={torch.cuda.get_device_name(0)}",
        flush=True,
    )
    torch.manual_seed(0)
    np.random.seed(0)
    model = init_model(str(config), str(checkpoint(args.cache)), device="cuda:0")
    assert tuple(model.CLASSES) == tuple(model.cfg.class_names)
    pipeline = Compose(model.cfg.data.test.pipeline)
    tracker = PubTracker(hungarian=False, max_age=3)
    last_time = scans[0]["timestamp"]
    frames = {}
    start = time.monotonic()
    for index, scan in enumerate(scans):
        record = lidar[scan["id"]]
        world = world_from(record)
        np.testing.assert_allclose(
            world, np.array(scan["worldFromLidar"]).reshape(4, 4).T, atol=1e-8
        )
        previous = record["prev"]
        sweeps = []
        while previous and len(sweeps) < 9:
            past = lidar[previous]
            relative = np.linalg.solve(world, world_from(past))
            sweeps.append(
                dict(
                    data_path=str(args.root / past["filename"]),
                    timestamp=past["timestamp"],
                    sensor2lidar_rotation=relative[:3, :3],
                    sensor2lidar_translation=relative[:3, 3],
                )
            )
            previous = past["prev"]
        boxes = infer(model, pipeline, args.root, record, sweeps)
        entries = boxes_for_tracker(boxes, world, model.CLASSES)
        tracks = tracker.step_centertrack(
            [
                entry
                for entry in entries
                if entry["detection_name"] in NUSCENES_TRACKING_NAMES
            ],
            (record["timestamp"] - last_time) / 1e6,
        )
        last_time = record["timestamp"]
        rows = [
            dict(
                id=f"all-track-{track['tracking_id']}",
                trackId=f"cp-all-{track['tracking_id']}",
                **track["row"],
            )
            for track in tracks
            if track["active"]
        ]
        rows.extend(
            dict(id=f"all-det-{rank}", trackId=None, **entry["row"])
            for rank, entry in enumerate(entries)
            if entry["detection_name"] not in NUSCENES_TRACKING_NAMES
        )
        assert len(rows) == len(boxes) == len({row["id"] for row in rows})
        frames[scan["id"]] = rows
        if index == 0:
            verify_first(rows, args.root / record["filename"])
        print(
            f"{index+1}/39 history={len(sweeps)} car={sum(row['category']=='Car' for row in rows)} "
            f"ped={sum(row['category']=='Pedestrian' for row in rows)} elapsed={time.monotonic()-start:.1f}s",
            flush=True,
        )
        if args.first:
            return
    target = ASSETS / "centerpoint.json"
    temp = target.with_suffix(".json.tmp")
    temp.write_text(
        json.dumps(
            dict(model="CenterPoint", scene=SCENE, frames=frames),
            separators=(",", ":"),
            allow_nan=False,
        )
        + "\n"
    )
    temp.replace(target)
    print(
        f"{target}: {len(frames)} frames / {sum(map(len, frames.values()))} detections",
        flush=True,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--cache", type=Path, default=CACHE)
    parser.add_argument(
        "--tracker", type=Path, default=Path.home() / "OpenProject/LidarOcc/CenterPoint"
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--inspect", action="store_true")
    mode.add_argument("--weights", action="store_true")
    mode.add_argument(
        "--first",
        action="store_true",
        help="infer and check first keyframe; no output file",
    )
    mode.add_argument(
        "--build",
        action="store_true",
        help="check first, infer 39 keyframes and publish atomically",
    )
    args = parser.parse_args()
    if args.weights:
        checkpoint(args.cache)
    elif args.inspect:
        sequence(args.root)
    else:
        generate(args)
