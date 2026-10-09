/** Views in the original paper frame: X right, Y up the sheet, Z out of its front. */
export interface PaperCameraView {
  /** Degrees around the paper's Z axis; zero looks from the bottom edge. */
  azimuth: number;
  /** Degrees above the paper plane, -89 to 89. */
  elevation: number;
  /** Distance as a multiple of the unfolded paper diagonal. */
  distance: number;
  /** Clockwise camera roll in degrees. */
  roll: number;
}
export function validateCameraView(view: PaperCameraView) {
  if (
    !Object.values(view).every(Number.isFinite) ||
    ![view.azimuth, view.elevation, view.distance, view.roll].every(
      Number.isFinite,
    ) ||
    Math.abs(view.elevation) > 89 ||
    view.distance < 0.2 ||
    view.distance > 10
  )
    throw new Error(
      "Camera views need finite angles, elevation -89–89°, and distance 0.2–10.",
    );
}
const angleDelta = (a: number, b: number) =>
  ((((b - a + 180) % 360) + 360) % 360) - 180;
/** First view is the open sheet; each following view is a completed fold. */
export function sampleCameraSequence(
  views: readonly PaperCameraView[],
  progress: number,
): PaperCameraView {
  if (!views.length || !Number.isFinite(progress))
    throw new Error("A camera sequence needs views and finite progress.");
  const position = Math.max(0, Math.min(1, progress)) * (views.length - 1);
  const i = Math.floor(position),
    a = views[i],
    b = views[Math.min(i + 1, views.length - 1)];
  const t = position - i,
    eased = t * t * (3 - 2 * t);
  return {
    azimuth: a.azimuth + angleDelta(a.azimuth, b.azimuth) * eased,
    elevation: a.elevation + (b.elevation - a.elevation) * eased,
    distance: a.distance + (b.distance - a.distance) * eased,
    roll: a.roll + angleDelta(a.roll, b.roll) * eased,
  };
}
