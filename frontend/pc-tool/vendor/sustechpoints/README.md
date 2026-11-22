# Bundled SUSTechPOINTS Editor

This directory contains the native browser editor used by the local annotation
workbench. It is ordinary source in this repository, not a submodule, symlink,
runtime download or dependency on a separate SUSTechPOINTS checkout.

## Origin and License

- Upstream: https://github.com/naurril/SUSTechPOINTS
- Source revision: `50fa18871a6d46507ff9057175669235885f79f9`
- Included: `index.html`, `public/` and the verbatim upstream `LICENSE`.
- License: [GNU GPL version 3](./LICENSE). Preserve the upstream and embedded
  third-party notices when distributing this component and its modifications.
- Local modifications and bundling: 2026-11-22. This is a modified distribution,
  not an unmodified upstream release. It is provided without warranty under the
  terms of its license.

## Local Changes

- Per-frame camera calibration and LiDAR world transforms for scene data.
- Saves through the parent workbench; automatic saves disabled by default.
- Geometry fitting without the optional TensorFlow orientation backend.
- Scene-wide object ID reservation and workbench category synchronization.
- Retained internal fallback category for temporary boxes during drawing.
- Faster central-view zoom via the existing OrbitControls setting.

The adapter and save bridge live in `../../scripts/` and `../../src/`.
Operational commands and supported features are maintained in the
[pc-tool README](../../README.md#sustechpoints-补漏入口).

The upstream Python server, training code, example datasets and Git history are
not included. The workbench's Node adapter supplies the editor endpoints;
CenterPoint and PubTracker remain responsible for pre-annotation. The optional
upstream full-frame detector and orientation network are not part of this local
workflow. Scene data, model environments and weights remain separate inputs.