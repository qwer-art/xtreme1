import assert from 'node:assert/strict';
import fs from 'node:fs';

const [debugUrl, root] = process.argv.slice(2);
const table = name => JSON.parse(fs.readFileSync(`${root}/v1.0-mini/${name}.json`));
const first = 'ca9a282c9e77460f8360f564131a8af5';
const next = table('sample').find(row => row.token === first).next;
const frames = [first, next].map(id => {
    const scan = table('sample_data').find(row => row.sample_token === id && row.is_key_frame && row.filename.includes('/LIDAR_TOP/'));
    return { id, file: scan.filename, pose: table('ego_pose').find(row => row.token === scan.ego_pose_token),
        calibration: table('calibrated_sensor').find(row => row.token === scan.calibrated_sensor_token) };
});
const source = fs.readFileSync(`${root}/${frames[1].file}`);
const count = source.length / 20;
const header = `VERSION 0.7\nFIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nCOUNT 1 1 1\nWIDTH ${count}\nHEIGHT 1\nPOINTS ${count}\nDATA binary\n`;
const positions = Buffer.alloc(count * 12);
for (let index = 0; index < count; index++) source.copy(positions, index * 12, index * 20, index * 20 + 12);

async function probe(frames, encoded) {
    const base = '/src/packages/pc-render/';
    const { default: PointCloud } = await import(base + 'PointCloud.ts');
    const { default: MainRenderView } = await import(base + 'renderView/MainRenderView.ts');
    const { default: Points } = await import(base + 'points/Points.ts');
    const { ColorModeEnum } = await import(base + 'material/PointsMaterial.ts');
    const { setTrialOverlay: set } = await import('/src/common/trialOverlay.ts');
    const pc = new PointCloud();
    const editor = { pc };
    const host = document.createElement('div');
    host.style.cssText = 'width:640px;height:480px';
    document.body.appendChild(host);
    const view = new MainRenderView(host, pc, { actions: [] });
    const cloud = new Points(pc.material);
    await cloud.loadUrl('/local-frame/points.pcd');
    pc.groupPoints.add(cloud);
    pc.material.setUniforms({ colorMode: ColorModeEnum.PURE, singleColor: '#b3bfb3', pointSize: 2 });
    const gl = view.renderer.getContext();
    const pose = row => {
        const [real, ...imaginary] = row.rotation;
        return pc.scene.matrix.clone().makeRotationFromQuaternion(view.camera.quaternion.clone().set(...imaginary, real)).setPosition(...row.translation);
    };
    const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(encoded), char => char.charCodeAt(0))]));
    const scans = frames.map(row => ({ id: row.id, worldFromLidar: pose(row.pose).multiply(pose(row.calibration)).toArray(), pointsUrl: url }));
    const toggle = radius => set(editor, scans, scans[0].id, radius);
    const pixels = () => {
        view.renderFrame();
        const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
        gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
        return data;
    };
    try {
        const current = pc.groupPoints.children.slice();
        const before = pixels();
        await toggle(1);
        const group = pc.scene.getObjectByName('trial-background-scans');
        const points = group.children[0];
        let disposed = 0;
        for (const resource of [points.geometry, points.material]) resource.addEventListener('dispose', () => disposed++);
        const after = pixels();
        let changed = 0, bright = 0, lost = 0;
        for (let index = 0; index < before.length; index += 4) {
            const differs = before[index] !== after[index] || before[index+1] !== after[index+1] || before[index+2] !== after[index+2];
            if (differs) changed++;
            if (before[index] === 179 && before[index+1] === 191 && before[index+2] === 179) {
                bright++;
                if (differs) lost++;
            }
        }
        const absolute = pose(frames[0].pose).multiply(pose(frames[0].calibration)).multiply(points.matrix);
        const aligned = absolute.elements.every((value, index) => Math.abs(value - scans[1].worldFromLidar[index]) < 1e-8);
        await toggle(0);
        const restored = pixels().every((value, index) => value === before[index]);
        const pending = toggle(1);
        await toggle(0);
        await pending;
        return { count: points.geometry.attributes.position.count, changed, bright, lost, aligned, disposed, restored,
            isolated: current.length === pc.groupPoints.children.length && current.every((item, index) => item === pc.groupPoints.children[index]),
            cancelled: !pc.scene.getObjectByName(group.name) };
    } finally {
        await toggle(0);
        URL.revokeObjectURL(url);
        cloud.geometry.dispose();
        pc.material.dispose();
        view.renderer.dispose();
        host.remove();
    }
}

const pages = await (await fetch(`${debugUrl}/json/list`)).json();
const socket = new WebSocket(pages.find(page => page.url.endsWith('/local-trial')).webSocketDebuggerUrl);
try {
    const result = await new Promise((resolve, reject) => {
        socket.onerror = reject;
        socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
            expression: `(${probe})(${JSON.stringify(frames)},${JSON.stringify(Buffer.concat([Buffer.from(header), positions]).toString('base64'))})`,
            awaitPromise: true, returnByValue: true,
        } }));
        socket.onmessage = event => {
            const response = JSON.parse(event.data);
            if (response.id !== 1) return;
            const error = response.error || response.result.exceptionDetails;
            if (error) reject(Error(error.exception?.description || JSON.stringify(error)));
            else resolve(response.result.result.value);
        };
    });
    console.log(result);
    assert.equal(result.count, count);
    assert.ok(result.changed > 0 && result.bright > 0 && result.lost === 0);
    assert.ok(result.aligned && result.disposed === 2 && result.restored && result.isolated && result.cancelled);
} finally {
    socket.close();
}