function inspectScene() {
    const editor = window.editor, cloud = editor?.pc.groupPoints.children[0];
    const position = cloud?.geometry.attributes.position;
    if (!position?.count) return null;
    const previews = [];
    editor.pc.scene.updateMatrixWorld(true);
    editor.pc.scene.traverseVisible(object => {
        if (!object.isLineSegments || !object.material.visible) return;
        let parent = object;
        while (parent && !/candidate|centerpoint/i.test(parent.name)) parent = parent.parent;
        if (!parent) return;
        const attribute = object.geometry.attributes.position, corners = new Map();
        for (let index = 0; index < attribute.count; index++) {
            const point = object.position.clone().fromBufferAttribute(attribute, index).applyMatrix4(object.matrixWorld);
            corners.set(point.toArray().map(value => value.toFixed(5)).join(','), point.toArray());
        }
        if (corners.size < 8) return;
        const heading = object.getObjectByName('heading');
        if (!heading?.visible || !heading.material.visible) return;
        const attributeHeading = heading.geometry.attributes.position;
        const arrow = [0, 1].map(index => object.position.clone().fromBufferAttribute(attributeHeading, index).applyMatrix4(heading.matrixWorld));
        const direction = arrow[1].clone().sub(arrow[0]);
        previews.push({ id: object.name, corners: [...corners.values()], lengthToTip: direction.length(), yaw: Math.atan2(direction.y, direction.x) });
    });
    return { id: editor.getCurrentFrame()?.id, count: position.count, previews,
        probes: [0, Math.floor(position.count / 2), position.count - 1].map(index => cloud.position.clone().fromBufferAttribute(position, index).applyMatrix4(cloud.matrixWorld).toArray()),
        accepted: editor.pc.getAnnotate3D().filter(object => !object.isHolder).map(object => ({
            id: object.userData.id || object.uuid, trackId: object.userData.trackId, category: object.userData.classId,
            center: object.position.toArray(), size: object.scale.toArray(), yaw: object.rotation.z,
        })) };
}

function corners(box) {
    const cos = Math.cos(box.yaw), sin = Math.sin(box.yaw);
    return [-1, 1].flatMap(vertical => [-1, 1].flatMap(lateral => [-1, 1].map(forward => {
        const along = forward * box.size[0] / 2, across = lateral * box.size[1] / 2;
        return [box.center[0] + along * cos - across * sin, box.center[1] + along * sin + across * cos,
            box.center[2] + vertical * box.size[2] / 2];
    })));
}

function matches(preview, box) {
    const angle = preview.yaw - box.yaw;
    return Math.abs(preview.lengthToTip - box.size[0] / 2) < 0.001 && Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))) < 0.001 && corners(box).every(expected =>
        preview.corners.some(actual => actual.every((value, axis) => Math.abs(value - expected[axis]) < 0.001)));
}

async function captureBev(page, box, focus = true) {
    const layout = await page.evaluate(async ({ box, vertices, focus }) => {
        const view = window.editor.viewManager.getMainView(), camera = view.camera;
        const target = camera.position.clone().fromArray(box.center);
        if (focus) {
            const controls = view.getAction('orbit-control').control;
            controls.target.copy(target);
            camera.position.copy(target);
            camera.position.z += Math.max(26, 5 * Math.max(...box.size));
            camera.position.y -= 0.001;
            camera.lookAt(target);
            controls.update();
        }
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        view.renderFrame();
        const rect = view.renderer.domElement.getBoundingClientRect();
        const clip = { x: Math.ceil(rect.x), y: Math.ceil(rect.y), width: Math.floor(rect.width) - 1, height: Math.floor(rect.height) - 1 };
        const projected = vertices.map(vertex => {
            const point = target.clone().fromArray(vertex).project(camera);
            return [(1 + point.x) * rect.width / 2 + rect.x - clip.x, (1 - point.y) * rect.height / 2 + rect.y - clip.y];
        });
        return { clip, projected };
    }, { box, vertices: corners(box), focus });
    const png = await page.screenshot({ clip: layout.clip, scale: 'css' });
    const evidence = await page.evaluate(async ({ base64, projected }) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), context = canvas.getContext('2d');
        context.drawImage(bitmap, 0, 0);
        const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
        const rgb = (x, y) => x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height ? [] :
            data.subarray((Math.round(y) * bitmap.width + Math.round(x)) * 4, (Math.round(y) * bitmap.width + Math.round(x)) * 4 + 3);
        const hits = [[4, 5], [5, 7], [7, 6], [6, 4]].map(([start, end]) => {
            const first = projected[start], last = projected[end];
            let count = 0;
            for (let step = 1; step <= 12; step++) {
                const fraction = step / 13, x = first[0] + fraction * (last[0] - first[0]), y = first[1] + fraction * (last[1] - first[1]);
                let hit = false;
                for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
                    const channels = rgb(x + dx, y + dy);
                    if (Math.max(...channels) - Math.min(...channels) > 55) hit = true;
                }
                if (hit) count++;
            }
            return count;
        });
        let cloudPixels = 0;
        const xs = projected.map(point => point[0]), ys = projected.map(point => point[1]);
        for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(bitmap.width - 1, Math.max(...xs)); x++) {
            for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(bitmap.height - 1, Math.max(...ys)); y++) {
                const [red, green, blue] = rgb(x, y);
                if (green > 100 && green > red && green - red < 25 && Math.abs(red - blue) < 6) cloudPixels++;
            }
        }
        bitmap.close();
        return { hits, cloudPixels };
    }, { base64: png.toString('base64'), projected: layout.projected });
    return { png, ...evidence };
}

module.exports = { inspectScene, matches, captureBev };