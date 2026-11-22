## Introduction

Point cloud annotation tool of Xtreme1, developed width Vue 3 + Typescript + Vite.

## Development
Install required  dependencies

```bash
npm install
```

Set proxy config in `vite.config.ts`

```javascript
// api proxy when development
proxy: {
    '/api': {
        changeOrigin: true,
        target: 'api address',
    },
},
```

Start the development server

```bash
npm run dev
```

Build

```bash
npm run build
```

## Local Paired-Frame Workbench

**标注员与部署人员：** [本地标注数据库 README](./docs/dataset-database.md) 提供当前试标库位置、原始帧与标注结果的对应关系、自采数据接口，以及新电脑的启动和验收命令。

On the configured workstation, launch Xtreme1 from the application icon. For a new workstation use the database guide above. Optional one-time import of existing legacy CenterPoint results on the original workstation: run `node scripts/import-centerpoint-run.cjs --ensure` from this directory. A copied scene with an active prediction run needs no import.

Open http://127.0.0.1:3200/local-trial. The default sequence contains 39 paired scans in scene-0061.
Previous/next changes the LiDAR cloud and its camera images together. Missing cameras keep their slots.
Choose 全部扫描 to browse all 382 scans. Both modes use the same LiDAR scan ID for annotations.
Choose a camera thumbnail to change the main image; double-click the image for a larger view. On desktop the right column shares space between review and the three orthographic views; drag the horizontal divider to resize them.

**核验单个目标：**

1. **看速度。** 点选待审核框看模型水平速度（m/s）；点云中的青色箭头表示按该速度运动 1 秒的位移，框顶原有箭头仍表示车头朝向。选中正式框则显示同 Track-ID 最近两次相关观测的世界坐标差分和时间间隔，单帧轨迹显示「待同 ID 第二帧」。速度只供查看，不改标注。
2. **看投影。** 在主相机图上对准目标滚轮缩放，放大后拖动平移；触屏可点 `+`、`−`，点复位恢复全图。缩略图保持全景，相机投影跟随主图一起缩放。
3. **调框。** 选中心轴、尺寸或航向，用 `+`、`−` 微调，错框点「拒绝」。其余默认保留，点「确认本帧」统一保存。正式框用正交视图手柄拖动，`Ctrl+Z` 撤销。

Camera images show the visible LiDAR boxes using each camera's calibration. Compare a box against the object in the main image, the six desktop thumbnails or the enlarged view. Adjusting a box updates the outline; hiding a candidate category removes its outlines in both views. Unpaired scans have no image to project onto. Selecting a CenterPoint candidate displays its frame index and track ID on the active camera; the overhead, side and rear views focus the same box and highlight its points.

Use 字号 next to the scene name to set the toolbar text to 18, 24 (default), 30 or 36 px. This browser remembers the setting without changing scene zoom.

Use the frame arrows or frame number to navigate. Open 邻帧 for overlay and radius, 轨迹 to copy the previous selection or assign a track, and 文件 to import or export JSON. The timestamp and selection are read-only. 快捷键 opens the key reference; on a phone the list icon in the top bar opens or closes review.

待审核行显示序号、轨迹 ID 和置信度，悬停可看完整编号。「确认本帧」只保存达到阈值且未隐藏的剩余候选；折叠类别仍计入，隐藏类别不计入。浏览、切帧不自动接受。

CenterPoint produces per-frame 3D detections; PubTracker associates eligible detections across frames and assigns track IDs. Existing runs load from the database without inference. Clicking 开始推理 creates a new run with separate `detections.json` and `tracking.json` files plus `run.json` provenance, then atomically updates `active.json`. Progress shows completed scans out of 39. The tracker supports seven classes; other detections have no cross-frame ID. Working annotations and review decisions persist in the database, not just this browser profile.

## Local Trial Validation

自有数据首次接入示例。先把点云放入 `yard-01/source/cloud/<微秒>.pcd`，相机放入 `source/image/front/<微秒>.jpg` 等通道目录，按[数据接口说明](./docs/dataset-database.md)填写 `source/param/{pose,calib}.json`。

```bash
cd /home/jerett/catkin_ws/src/xtreme1/frontend/pc-tool
export XTREME1_DB_ROOT="$HOME/datasets/perception/xtreme1/my-dataset"
export XTREME1_SCENE_ID=yard-01
node scripts/index-local-scene.cjs "$XTREME1_DB_ROOT/$XTREME1_SCENE_ID"
npm run dev -- --host 127.0.0.1 --port 3201 --strictPort
```

以后用相同环境变量直接启动，打开 http://127.0.0.1:3201/local-trial 。索引命令只需执行一次，不覆盖已有清单。手工标注无需推理；当前 CenterPoint 构建器仅适配 nuScenes mini 的 `scene-0061`。

后台验证自有格式（临时单相机场景，含无图帧、导出和工作稿回写）：

```bash
node --test tests/custom-scene.cjs
```

验证缩放、微调与撤销（从 `frontend/pc-tool` 执行）：

```bash
node scripts/test-camera-zoom.cjs   # 已启动的本机页面，只读；含桌面与触屏
node tests/box-nudge.cjs            # 临时场景库：调框、接受、拖动与撤销
```

Check the offline CenterPoint predictions against the raw point cloud:

```bash
node tests/centerpoint-trial.cjs --assets
```

Run the browser review, persistence and archive flow in an isolated temporary database:

```bash
node scripts/test-trial-database.cjs
```

Check the Point-SAM service on port 3211 using the first scene scan and local nuScenes data:

```bash
env -u PYTHONPATH ~/anaconda3/envs/point_pillar/bin/python scripts/trial_model_test.py
```

Rebuild the offline proposals from the original LiDAR scans (not needed for normal review):

```bash
cd /home/jerett/catkin_ws/src/xtreme1/frontend/pc-tool && env -u PYTHONPATH PYTHONDONTWRITEBYTECODE=1 OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 ~/anaconda3/envs/point_pillar/bin/python scripts/build-centerpoint.py --build
```

For a missed target, expand 辅助标注 and enable Point-SAM. The button displays the current tool. Point-SAM is off by default and independent of the CenterPoint run. Click a target point in the main cloud to preview its mask and box.
Add foreground points or switch to background points to refine the same candidate automatically.
Accept to save the box and start the next target, or reject it. Model inference requires the local service on port 3211.
For manual annotation, select Car, Pedestrian or Cyclist in Instances.
Choose the manual or AI Box method in the header, then press **F**. In manual mode,
click three footprint corners; in AI Box mode, drag a rectangle around one target
in the top-down point cloud. AI Box fits geometry; it does not detect a whole frame.
With a box selected, use **A/D**, **Q/E**, **W/S** to translate, **Z/X** to rotate,
**Delete** to remove or **Ctrl+Z** to undo. Press **Ctrl+S** or click **Save**
before refreshing. Saved labels use the native object format and persist to the database. Use 文件 → 归档已确认版本 to write an immutable accepted snapshot. Browser localStorage is only a cache. This development-only URL requires no cloud backend or login.

## Related Information

- [Camera parameter](./docs/camera_config.md)
