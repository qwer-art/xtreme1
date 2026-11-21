export function isTrialFrameImage(frameId: string | undefined, imageUrl?: string) {
    return !!frameId && !!imageUrl?.startsWith(`/local-scene/${frameId}/`);
}