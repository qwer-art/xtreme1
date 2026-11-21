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

Launch Xtreme1 from the application icon, or start it manually with dependencies installed:

```bash
cd /home/jerett/catkin_ws/src/xtreme1/frontend/pc-tool
node scripts/generate-local-scene.cjs --ensure
npm run dev -- --host 127.0.0.1 --port 3200 --strictPort
```

Open http://127.0.0.1:3200/local-trial. The default sequence contains 39 paired scans in scene-0061.
Previous/next changes the LiDAR cloud and its camera images together. Missing cameras keep their slots.
Choose 全部扫描 to browse all 382 scans. Both modes use the same LiDAR scan ID for annotations.
Choose a camera thumbnail to change the main image; double-click the image for a larger view. On desktop the right column shares space between review and the three orthographic views; drag the horizontal divider to resize them.

Camera images show the visible LiDAR boxes using each camera's calibration. Compare a box against the object in the main image, the six desktop thumbnails or the enlarged view. Adjusting a box updates the outline; hiding a candidate category removes its outlines in both views. Unpaired scans have no image to project onto.

Use the frame arrows or frame number to navigate. Open 邻帧 for overlay and radius, 轨迹 to copy the previous selection or assign a track, and 文件 to import or export JSON. The timestamp and selection are read-only. 快捷键 opens the key reference; on a phone the list icon in the top bar opens or closes review.

In 待审核, click a CenterPoint category name to expand its objects and scores. Click the separate eye to hide or show all of that category's candidate boxes, headings and labels in the cloud. Visibility carries across frame changes without changing pending counts or saved annotations. Object numbers stay stable within the frame and category. Selecting a visible box in the cloud opens its category. Instances is a separate tab.

CenterPoint is the prelabel model. Review existing offline results directly, or click 开始推理 to rebuild them on the local GPU. Progress shows completed scans out of 39 and the percentage; the workbench reloads results after successful publication. The export retains all detector outputs after model post-processing, including scores and world-frame XY velocity (m/s). The tracker supports seven classes; other detections have no cross-frame ID. Adjust and accept to save a box, or reject it; review decisions persist in this browser profile. Reviewing saved predictions does not require the GPU.

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
before refreshing. Labels use the native object format and stay in this
browser's localStorage, keyed by LiDAR sample_data token. Use the same host, port and browser profile
to reopen them. This development-only URL requires no backend or login.

## Related Information

- [Camera parameter](./docs/camera_config.md)
