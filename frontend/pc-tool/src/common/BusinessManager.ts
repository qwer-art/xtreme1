import {
    BusinessManager as BaseBusinessManager,
    IDataResource,
    IImgViewConfig,
    IFrame,
    IObject,
    utils,
    IFileConfig,
    SourceType,
} from 'pc-editor';
import Editor from './Editor';
import * as api from '../api';
import { localTrial, readLocalObjects } from './localTrial';
import { configureTrialCreation } from './trialAnnotations';
import { scans } from './trialScene';

export default class BusinessManager extends BaseBusinessManager {
    editor: Editor;
    constructor(editor: Editor) {
        super(editor);
        this.editor = editor;
    }

    async loadFrameConfig(data: IFrame): Promise<IDataResource> {
        if (localTrial) {
            const scan = scans.find(item => item.id === data.id);
            if (!scan) throw new Error(`Unknown local scan: ${data.id}`);
            let viewConfig = [];
            if (scan.viewsUrl) {
                const response = await fetch(scan.viewsUrl);
                if (!response.ok) throw new Error(`${scan.viewsUrl}: HTTP ${response.status}`);
                const linked: IImgViewConfig[] = await response.json();
                const decoded = await Promise.all(linked.map(async view => {
                    const image = new Image();
                    image.src = view.imgUrl;
                    try { await image.decode(); } catch { return null; }
                    return { ...view, imgObject: image };
                }));
                viewConfig = decoded.filter(view => view !== null);
            }
            return { pointsUrl: scan.pointsUrl, pointsData: {}, viewConfig,
                time: 0, name: 'scene-0061' };
        }
        const regLidar = new RegExp(/point(_?)cloud/i);
        const regConfig = new RegExp(/camera(_?)config/i);
        let { configs: fileConfig, name } = await api.getDataFile(data.id + '');
        if (fileConfig.filter((e) => regLidar.test(e.dirName)).length === 0) {
            throw this.editor.lang('no-point-data');
        }
        let cameraConfig = fileConfig.find((e) => regConfig.test(e.dirName)) as IFileConfig;

        // no camera config
        let cameraInfo = [];
        if (cameraConfig) {
            cameraInfo = await api.getUrl(cameraConfig.url);
        }

        let info = utils.createViewConfig(fileConfig, cameraInfo);
        let config: IDataResource = {
            pointsUrl: info.pointsUrl,
            pointsData: {},
            viewConfig: info.config,
            time: 0,
            name: name,
        };
        return config;

        // return {} as IDataResource;
    }

    async getFrameClassification(
        frame: IFrame | IFrame[],
    ): Promise<Record<string, Record<string, string>>> {
        if (localTrial) return {};
        let valueMap = await api.getDataClassificationBatch(
            Array.isArray(frame) ? frame.map((e) => e.id) : frame.id,
        );
        return valueMap;
    }

    async getFrameObject(frame: IFrame | IFrame[]): Promise<{
        objectsMap: Record<string, IObject[]>;
        classificationMap: Record<string, IObject[]>;
        queryTime: string;
    }> {
        if (localTrial) {
            configureTrialCreation(this.editor);
            return readLocalObjects(frame);
        }
        let data = await api.getDataObjectBatch(
            Array.isArray(frame) ? frame.map((e) => e.id) : frame.id,
        );
        return data;
    }
}
