import { scans } from '../../common/trialScene';

export function isTrialFrameImage(frameId: string | undefined, imageUrl?: string) {
    return !!imageUrl && !!scans.find(scan => scan.id === frameId)?.views.some(view => view.imgUrl === imageUrl);
}