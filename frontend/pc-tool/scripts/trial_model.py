"""Point-SAM inference on an ordered XYZ scan; yaw is in radians about +Z."""

import sys
from pathlib import Path
from time import perf_counter

import numpy as np
import torch
from hydra.utils import instantiate
from omegaconf import OmegaConf
from safetensors.torch import load_model

from trial_model_ops import install_ops

REPO = Path("/home/jerett/OpenProject/Detect/Point-SAM")
WEIGHTS = Path("/home/jerett/datasets/weights/point-sam/model.safetensors")


class InvalidInput(ValueError):
    pass


def parse(request):
    if not isinstance(request, dict) or not all(
        isinstance(request.get(key), str) and request[key].strip()
        for key in ("scan_id", "category")
    ):
        raise InvalidInput("scan_id and category must be nonempty strings")
    points = request.get("points")
    if not isinstance(points, list) or not 3 <= len(points) <= 100000:
        raise InvalidInput("expected 3 to 100000 XYZ points")
    if any(
        not isinstance(row, list)
        or len(row) != 3
        or any(
            type(value) not in (int, float) or not -1e10 <= value <= 1e10
            for value in row
        )
        for row in points
    ):
        raise InvalidInput(
            "each point must contain three finite numeric coordinates within +/-1e10"
        )
    prompts = request.get("prompts")
    if not isinstance(prompts, list) or not 1 <= len(prompts) <= 256:
        raise InvalidInput("expected 1 to 256 prompts")
    labels = {}
    for prompt in prompts:
        if not isinstance(prompt, dict) or type(prompt.get("positive")) is not bool:
            raise InvalidInput("each prompt needs a boolean positive label")
        index = prompt.get("index")
        if type(index) is not int or not 0 <= index < len(points):
            raise InvalidInput("prompt index outside submitted scan")
        if index in labels and labels[index] != prompt["positive"]:
            raise InvalidInput("conflicting labels for one point")
        labels[index] = prompt["positive"]
    if not any(labels.values()):
        raise InvalidInput("at least one positive prompt is required")
    return np.asarray(points, dtype=np.float64), labels


def fit_box(points):
    origin = points.mean(axis=0)
    centered = points - origin
    _, axes = np.linalg.eigh(centered[:, :2].T @ centered[:, :2])
    local = centered.copy()
    local[:, :2] = centered[:, :2] @ axes
    low, high = local.min(axis=0), local.max(axis=0)
    midpoint, size = (low + high) / 2, high - low
    midpoint[:2] = midpoint[:2] @ axes.T
    major = int(size[1] >= size[0])
    yaw = np.arctan2(axes[1, major], axes[0, major])
    return (
        (origin + midpoint).tolist(),
        size[[major, 1 - major, 2]].tolist(),
        float(yaw % np.pi),
    )


class PointSAM:
    def __init__(self):
        sys.path.insert(0, str(REPO))
        install_ops()
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        torch.set_num_threads(min(8, torch.get_num_threads()))
        self.model = instantiate(OmegaConf.load(REPO / "configs/model/default.yaml"))
        load_model(self.model, str(WEIGHTS), strict=True)
        self.model.eval().to(self.device)

    @torch.inference_mode()
    def segment(self, request):
        start = perf_counter()
        points, prompts = parse(request)
        clicks = points[list(prompts)]
        focus = clicks.mean(axis=0)
        radius = np.linalg.norm(clicks - focus, axis=1).max() + 12.0
        region = np.flatnonzero(np.linalg.norm(points - focus, axis=1) <= radius)
        if len(region) < 3:
            raise InvalidInput("fewer than three points in the prompt neighborhood")
        local = points[region]
        centered = local - local.mean(axis=0)
        scale = np.linalg.norm(centered, axis=1).max()
        if not scale:
            raise InvalidInput("point cloud has zero spatial extent")
        coords = torch.as_tensor(
            centered / scale, dtype=torch.float32, device=self.device
        )[None]
        grouper = self.model.pc_encoder.patch_embed.grouper
        grouper.num_groups = min(512, len(local))
        grouper.group_size = min(64, len(local))
        labels = torch.tensor(list(prompts.values()), device=self.device)[None]
        logits, scores = self.model.predict_masks(
            coords,
            torch.zeros_like(coords),
            coords[:, np.searchsorted(region, list(prompts)).tolist()],
            labels,
        )
        if not (scores.isfinite().all() and logits.isfinite().all()):
            raise RuntimeError("Point-SAM produced nonfinite outputs")
        indices = region[
            torch.where(logits[0, scores[0].argmax()] > 0)[0].cpu().numpy()
        ]
        if not len(indices):
            raise InvalidInput(
                "Point-SAM returned an empty mask; try a different prompt"
            )
        center, size, yaw = fit_box(points[indices])
        return dict(
            indices=indices.tolist(),
            center=center,
            size=size,
            yaw=yaw,
            elapsed_ms=round((perf_counter() - start) * 1000, 2),
        )
