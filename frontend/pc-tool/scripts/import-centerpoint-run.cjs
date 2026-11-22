const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { sceneRoot, sourceRoot, predictionRoot } = require('./trial-database.cjs');

const legacy = path.resolve(__dirname, '../public/local-scene/centerpoint.json');
const active = path.join(predictionRoot, 'active.json');

function ensure() {
    if (fs.existsSync(active) || !fs.existsSync(legacy) || !fs.existsSync(path.join(sourceRoot, 'index.json'))) return;
    const bytes = fs.readFileSync(legacy);
    const result = JSON.parse(bytes);
    const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'index.json'), 'utf8'));
    if (result.model !== 'CenterPoint' || result.scene !== 'scene-0061' || manifest.scene !== result.scene)
        throw new Error('Legacy prediction does not match the database scene');
    const scanIds = new Set(manifest.frames.map(scan => scan.id));
    for (const scanId of Object.keys(result.frames || {})) {
        if (!scanIds.has(scanId)) throw new Error(`Unknown source scan in prediction: ${scanId}`);
    }
    const digest = createHash('sha256').update(bytes).digest('hex');
    const runId = `legacy-import-${digest.slice(0, 16)}`;
    const runDir = path.join(predictionRoot, 'runs', runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'tracking.json'), bytes);
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify({
        schema: 'xtreme1-inference-run-v1', runId, status: 'imported',
        importedAt: new Date().toISOString(), inferenceTime: 'unknown',
        scene: 'scene-0061', sourceDataset: 'nuScenes-v1.0-mini',
        detector: { name: 'CenterPoint', output: 'post-NMS detections' },
        tracker: { name: 'PubTracker', output: 'legacy tracked result' },
        outputs: { tracks: 'tracking.json', detections: null },
        sourceFile: 'legacy public/local-scene/centerpoint.json', sourceSha256: digest,
        note: 'Legacy result contains final tracked boxes; raw detector output was not retained separately.',
    }, null, 2) + '\n');
    fs.mkdirSync(predictionRoot, { recursive: true });
    const temp = path.join(predictionRoot, 'active.json.tmp');
    fs.writeFileSync(temp, JSON.stringify({ runId, tracking: 'tracking.json' }) + '\n');
    fs.renameSync(temp, active);
    console.log(`Imported existing inference without rerunning: ${path.join(runDir, 'tracking.json')}`);
}

if (process.argv.includes('--ensure')) ensure();
else ensure();
