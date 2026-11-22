# Xtreme1 本地标注数据库 README

**一个数据集一个目录，一段连续采集一个场景。** 本地标注台按场景读取原始输入、模型候选和人工结果；代码仓库维护接口，数据保存在仓库外。这是 `/local-trial` 的文件库，与 Docker 平台的 MySQL、MinIO 分开。

## 标注员：打开、续标、交付

**当前试标库：** `/home/jerett/datasets/perception/xtreme1/nuscenes-v1.0-mini/scene-0061/`。下表中的路径均相对这个场景目录。

| 要做什么 | 在标注台怎么做 | 对应磁盘数据 |
| --- | --- | --- |
| 看原始帧 | [打开本机标注台](http://127.0.0.1:3200/local-trial)。默认看 39 个配对帧；切到「全部扫描」可看 382 帧点云。 | `source/`：382 个 PCD，六路相机各 39 张 JPEG，共 234 张。无图扫描也有点云。 |
| 看已有候选 | 打开「待审核」查看当前模型结果，不必重新推理。 | `predictions/centerpoint-pubtracker/active.json` 指向当前运行。 |
| 保存并续标 | 接受或修正候选后按 `Ctrl+S`；下次打开同一场景继续。 | `annotations/working/scene-0061.json` 是人工工作稿；候选审核决定另存于 `annotations/review-decisions.json`。 |
| 交付确认版 | 审核完成后点「文件 → 归档已确认版本」。 | `annotations/accepted/latest.json` 指向本次版本；交付同目录的 `<version>.json`，不是指针或工作稿。 |

**认一组真实文件：** 点云 `source/cloud/1532402927647951.pcd` 配到前视图 `source/image/CAM_FRONT/1532402927612460.jpg`。两者相差约 35 毫秒，由帧索引配对，不要改名凑成相同时间戳。2026-11-22 核查时该场景尚无确认版；首次归档后才会出现 `accepted/latest.json`。

## 场景目录：原始、过程、确认版

集合根目录默认为 `~/datasets/perception/xtreme1/`。完整迁移的最小单位是一个场景目录，保留数据集 ID 和场景 ID。

```text
xtreme1/
└── <dataset-id>/
    └── <scene-id>/
        ├── dataset.json
        ├── source/
        │   ├── dataset.json
        │   ├── index.json
        │   ├── cloud/
        │   │   └── <lidar_timestamp_us>.pcd
        │   ├── image/
        │   │   └── <camera_channel>/<camera_timestamp_us>.jpg
        │   └── param/
        │       ├── pose.json
        │       └── calib.json
        ├── predictions/centerpoint-pubtracker/
        │   ├── active.json
        │   └── runs/<run-id>/          # 运行记录、检测或跟踪结果
        └── annotations/
            ├── working/<scene-id>.json
            ├── history/<timestamp>-<hash>.json
            ├── review-decisions.json
            └── accepted/{latest.json,<version>.json}
```

场景根的 `dataset.json` 是库目录说明（`xtreme1-scene-database-v1`）；页面实际读取的是 `source/dataset.json`。新场景可从原始输入开始，工作稿、历史与归档由操作生成，无需预造空结果。

## 新电脑：接手已有场景

1. **搬数据。** 在旧机保存并停止写入，把整个 `<dataset-id>/<scene-id>/` 复制到新机集合根目录。只复制 `source/` 可以看原始帧，会遗漏候选和人工结果。新机账户须能读取输入、写入场景的 `annotations/`。
2. **启动。** 准备含本地标注台的同版仓库、Node.js（建议 22.22.2）和 npm。首次安装须能访问 npm 仓库或已有完整缓存。从仓库根目录执行；`XTREME1_DB_ROOT` 指向**数据集**一级，不是集合、场景或 `source/`。

    ```bash
    cd frontend/pc-tool
    npm ci --legacy-peer-deps
    export XTREME1_DB_ROOT="$HOME/datasets/perception/xtreme1/nuscenes-v1.0-mini"
    export XTREME1_SCENE_ID="scene-0061"
    npm run dev -- --host 127.0.0.1 --port 3200 --strictPort
    ```

3. **验收。** 在新机打开 [本地标注台](http://127.0.0.1:3200/local-trial)，切换两个配对帧，对照点云、前视图和工作稿。另开终端执行下面的只读检查，返回的场景名和帧数应与移交清单一致。可以在临时库验证保存和归档，不向正式库写测试框。

    ```bash
    curl --noproxy '*' -fsS http://127.0.0.1:3200/local-scene/dataset.json
    # 从仓库根目录运行，使用测试自己的临时库
    node frontend/pc-tool/tests/trial-database.cjs
    ```

切换场景时更改两个环境变量并重启服务。端口占用时改用空闲端口，浏览器和检查命令同步改端口。此流程使用 Vite 本机服务，不需要 Docker、Python 或重新推理。

只有**从原版 nuScenes mini 重建示例输入**才使用 `node scripts/generate-local-scene.cjs --ensure /path/to/v1.0-mini`（在 `frontend/pc-tool` 下执行）。该导入器固定生成 `scene-0061`。自采数据直接按下表适配；重新运行 CenterPoint 或 Point-SAM 另需配置对应模型、环境和数据路径，见[点云工具操作说明](../README.md)。

## 数据接口：自采场景如何接入

输入只用三种格式：点云 PCD 0.7，二进制 `x y z intensity` 四个 float32；各相机原始 JPEG；索引、位姿和标定用 JSON。所有资产路径相对 `source/`，长度用米，采集时间用正整数微秒。

| 文件（相对 `source/`） | `schema` | 接入约定 |
| --- | --- | --- |
| `dataset.json` | `xtreme1-dataset-v1` | `scene` 等于场景 ID；`sourceDataset` 记来源；`coordinateFrame` 对应参考雷达名。声明 `lengthUnit: m`、`timestampUnit: us`、通道、总帧数与配对帧数。 |
| `index.json` | `xtreme1-frame-index-v1` | `scene` 与输入清单一致。`frames[]` 按雷达采集时间递增；每帧给稳定字符串 `id`、唯一 `timestamp`、`cloud`、`keyframe` 和 `images[]`。 |
| `param/pose.json` | `xtreme1-pose-v1` | `frames[雷达时间戳字符串][传感器名]` 含该传感器的 `timestamp` 和 `worldFromSensor`；后者是传感器到世界的 4×4 矩阵，按列存 16 个数。 |
| `param/calib.json` | `xtreme1-calibration-v1` | `lidar[参考雷达名]`、`cameras[通道名]` 存静态 `egoFromSensor`（同矩阵格式）；相机另给 `imageSize: [宽, 高]`、以像素为单位的 `cameraInternal: {fx,fy,cx,cy}`。 |

**生成索引：** 准备 `cloud/`、`image/<通道>/`、`param/` 后，按[点云工具操作说明](../README.md)运行 `index-local-scene.cjs`。它从 PCD 文件名生成稳定帧 ID，并生成上表前两份 JSON；已有清单不会被覆盖。

**配对示例：** 点云 `cloud/1700000000000000.pcd` 对应 `pose.frames["1700000000000000"]`。若其中 `front.timestamp` 是 `1700000000000120`，索引器就选 `image/front/1700000000000120.jpg`。未配对的通道省略，不猜最近帧；纯点云场景可设 `cameras: {}`，默认进入「全部扫描」。

**投影：** 相机拍摄时的位姿求逆，再乘雷达采集时的位姿；`worldFromSensor` 已含静态外参，不再乘一次。`sampleToken` 仅是 nuScenes 来源标识。

**人工结果：** 工作稿和确认版均为 `version: 3`。`frames[].scan_id` 对应索引 `id`，`timestamp_us` 与索引一致。`bbox_id` 在场景内唯一；`track_id` 跨帧标识同一物体，同帧只出现一次。框含 `class_id`、中心、长宽高（米）、XYZ 欧拉角（弧度）。`geometry.coordinate_frame` 取实际雷达名，例如 `roof_lidar (current scan)`。

**本机 HTTP 接口：**

| 操作 | 方法与路径 | 文件行为 |
| --- | --- | --- |
| 读取输入 | `GET/HEAD /local-scene/<相对路径>` | 只读映射 `source/`。 |
| 读取候选 | `GET /trial-data/centerpoint` | 按 `active.json` 的 `runId` 读 `runs/<run-id>/tracking.json`。新推理另存 `detections.json`；历史导入可只有跟踪结果与 `run.json` 来源记录。 |
| 续标、保存 | `GET/PUT /trial-data/annotations` | 读写整场工作稿，内容变化另写 `history/`；没有多人合并。 |
| 读写审核决定 | `GET/PUT /trial-data/reviews` | 读写候选决定映射，不发布确认版。 |
| 归档 | `POST /trial-data/annotations/archive` | 提交 `{ "document": ... }`，新建版本并更新 `latest.json` 的 `version`、`sha256` 和框数。 |

`/trial-data/` 供本机同源访问；写入使用 `Content-Type: application/json`。新场景还没有候选、工作稿或审核记录时，对应 GET 返回 `404` 属于正常状态；必需的源清单返回 `404` 则应检查根目录和场景 ID。

## 批量标注前的放行条件

1. **固定身份。** 用数据来源和版本命名数据集，给每段采集分配稳定的场景 ID。新场景的浏览器缓存按数据集来源和场景名区分。开标后不重排 ID、不覆盖 `source/`；更换输入或标定时开新版本。
2. **先验输入。** 核对索引条数、文件存在性、通道名称、位姿和时间单位。先用一段短场景核验静态物体投影及邻帧运动；若多处同向偏移，先查同步和标定，再派发标框。
3. **按场景派工。** 同一场景同一时段仅一人写工作稿，交接前先保存。先约定类别、框尺寸和遮挡时的轨迹延续规则，由审核员检查首批样例，再展开同类场景。
4. **按版本交付。** 记录数据集、场景、采用的预测 `runId`（如有）、确认版 `version` 和 SHA-256。训练或验收引用指定版本；备份整个场景并核对确认版文件摘要，浏览器缓存不作为备份。
