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

主图和展开图显示当前帧的点云和框；六张缩略图只用来选相机。点云按相机光轴深度分色，不代表类别：红 <3 m、金 3–4 m、青绿 4–6 m、蓝 6–10 m、紫 10–20 m、灰 ≥20 m。换帧不换色标。点主图右下角「点云投影」可隐藏点和图例，保留框线。

同一小片像素保留近表面；扫描线间隙仅在两侧有相近的前景深度时过滤远点。缺少前景回波处仍可能看到背景点。候选框和轨迹编号始终作为标注线索叠在图上；无配对图像的扫描不显示相机投影。

Use 字号 next to the scene name to set the toolbar text to 18, 24 (default), 30 or 36 px. This browser remembers the setting without changing scene zoom.

Use the frame arrows or frame number to navigate. Open 邻帧 for overlay and radius, 轨迹 to copy the previous selection or assign a track, and 文件 to import or export JSON. The timestamp and selection are read-only. 快捷键 opens the key reference; on a phone the list icon in the top bar opens or closes review.

待审核行显示序号、轨迹 ID 和置信度，悬停可看完整编号。「确认本帧」只保存达到阈值且未隐藏的剩余候选；折叠类别仍计入，隐藏类别不计入。浏览、切帧不自动接受。

CenterPoint produces per-frame 3D detections; PubTracker associates eligible detections across frames and assigns track IDs. Existing runs load from the database without inference. Clicking 开始推理 creates a new run with separate `detections.json` and `tracking.json` files plus `run.json` provenance, then atomically updates `active.json`. Progress shows completed scans out of 39. The tracker supports seven classes; other detections have no cross-frame ID. Working annotations and review decisions persist in the database, not just this browser profile.

## Local Trial Validation

### SUSTechPOINTS 补漏入口

CenterPoint 检测 → PubTracker 关联 → 同台 SUSTechPOINTS 补标。打开 [Xtreme1 标注台](http://127.0.0.1:3200/local-trial)，顶部「单目标辅助」点 **SUSTechPOINTS**，携带当前帧进入原生编辑模式，不打开新页面。

```bash
cd /home/jerett/catkin_ws/src/xtreme1/frontend/pc-tool
npm run dev -- --host 127.0.0.1 --port 3200 --strictPort
```

1. 当前 `scene-0061` 支持 39 个图像配对帧、6 相机。打开时先保存标注台改动，复用已有预测，不重跑模型。
2. `Ctrl+拖框` 圈单个目标，原生三视图调整位置、尺寸和朝向；类别和 ID 在框旁工具栏修改。
3. 补已有轨迹沿用其数字 ID，新目标使用自动编号。几何贴合不调用额外朝向网络，方向人工核准。
4. 点上方「返回标注台」，自动保存补框并直接返回，无修改时直接退出。保存失败会保留当前编辑，可重试；原生磁盘按钮也写入同一工作稿。

同台模式的类别列表与主标注台一致；旧页面中的 `BicycleRider` 保存为 `Cyclist`，框几何保持不变。

补标返回后，主视图默认显示框信息；选中栏同步显示完整 ID。标签拥挤时优先保留选中框。

- `idx`：本帧框序号，从 1 开始，增删后重排；唯一框标识仍为 `bbox_id`。
- `ID`：跨帧轨迹 `track_id`；语义为 `class_id`。在类别面板修改语义，在「轨迹 → 分配轨迹」关联同一目标。
- 速度：同 ID 最近人工标注帧的世界坐标水平位移除以真实时间差，已补偿自车运动，单位 m/s。
- 新目标只有一帧时显示「待同 ID 第二帧」。在下一帧补框并分配相同 ID 后自动计算；没有速度时保存 `null`，不填 0。

保存、导出和归档均写入 `idx` 与 `velocity`；拖框、改 ID、删除邻帧会重算，字段见[数据接口](./docs/dataset-database.md)。

中央点云滚轮已加快：每次滚轮事件拉近约 14%，缩远约 17%。核验单个目标时，选框后点框旁工具栏的 `focus` 按钮，直接拉近并隐藏周围背景；再次点击恢复原视角。缩放与聚焦只改变观察，不改框几何。

保存位置统一为场景库 `annotations/working/scene-0061.json`，沿用历史记录与「文件 → 导出 JSON / 归档已确认版本」。仅新增、修改的框进入正式工作稿，删除的候选记为拒绝；未改预标注仍待审核。PubTracker ID 保留，新目标 Track ID 为 `sustech-<数字>`。

原生编辑器源码、静态资源和适配均内置于 [vendor/sustechpoints](./vendor/sustechpoints/README.md)，不需要另克隆 SUSTechPOINTS、设置外部源码路径或启动 3202 服务。

内置组件按 [GPL-3.0](./vendor/sustechpoints/LICENSE) 保留原许可与版权声明；发布其修改版时应一并提供对应源码与许可。主库原有许可文件不变。

初始预标注阈值 0.5，已有人工框和调框优先，拒绝项排除。同台模式不读写旧独立补标稿；旧稿原位保留。

开发验收（临时库，不改正式结果）：

```bash
node scripts/test-sustechpoints-merge.cjs
node scripts/test-sustechpoints-workbench.cjs
node scripts/test-trial-velocity.cjs
node scripts/test-trial-box-metadata.cjs
```

### 场景数据验收

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

**图里看得清的漏检行人：** 在主相机图点「图上框行人」，拖框贴住这一个人。系统用框内雷达回波估计深度和三维框；对照图上的绿色投影和点云，满意再点「确认并保存」。回波不足时换机位或手工建框。这个工具拟合直立行人，不估计朝向。

其他漏检可按 `P` 开关 Point-SAM，按 `Q` 点目标前景生成候选；误选时按 `E` 补背景点。为每个候选选择类别后点「确认并保存」，错框点「拒绝」。Point-SAM 使用本机 3211 端口，独立于 CenterPoint。
For manual annotation, select Car, Pedestrian or Cyclist in Instances.
Choose the manual or AI Box method in the header, then press **F**. In manual mode,
click three footprint corners; in AI Box mode, drag a rectangle around one target
in the top-down point cloud. AI Box fits geometry; it does not detect a whole frame.
With a box selected, use **A/D**, **Q/E**, **W/S** to translate, **Z/X** to rotate,
**Delete** to remove or **Ctrl+Z** to undo. Press **Ctrl+S** or click **Save**
before refreshing. Saved labels use the native object format and persist to the database. Use 文件 → 归档已确认版本 to write an immutable accepted snapshot. Browser localStorage is only a cache. This development-only URL requires no cloud backend or login.

## Related Information

- [Camera parameter](./docs/camera_config.md)
