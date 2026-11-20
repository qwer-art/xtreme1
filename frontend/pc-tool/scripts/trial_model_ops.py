"""Process-local Torch implementations for Point-SAM's optional torkit3d imports."""

import sys
from types import ModuleType

import torch


def batch_index_select(values, indices, dim=1):
    if dim != 1:
        raise ValueError("Point-SAM inference expects indexing along dimension 1")
    batch = torch.arange(len(values), device=values.device)
    return values[batch.reshape(-1, *([1] * (indices.ndim - 1))), indices.long()]


def sample_farthest_points(points, count):
    batch, length, _ = points.shape
    distances = points.new_full((batch, length), float("inf"))
    current = torch.zeros(batch, dtype=torch.long, device=points.device)
    batches = torch.arange(batch, device=points.device)
    selected = []
    for _ in range(count):
        selected.append(current)
        delta = points - points[batches, current].unsqueeze(1)
        distances = torch.minimum(distances, delta.square().sum(-1))
        current = distances.argmax(-1)
    return torch.stack(selected, dim=1)


def chamfer_distance(first, second):
    squared = torch.cdist(first, second).square()
    return squared.amin(-1), squared.amin(-2)


def install_ops():
    modules = {
        "torkit3d.nn.functional": batch_index_select,
        "torkit3d.ops.sample_farthest_points": sample_farthest_points,
        "torkit3d.ops.chamfer_distance": chamfer_distance,
    }
    for name, operation in modules.items():
        module = ModuleType(name)
        setattr(module, operation.__name__, operation)
        sys.modules[name] = module
