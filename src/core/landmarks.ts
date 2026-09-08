/**
 * MediaPipe Face Landmarker indices used by the fitting core (spec Appendix A).
 * "Left"/"right" are in IMAGE space (image-left = subject's right side).
 * The mesh has 468 face points plus 10 iris points (468..477).
 */
export const LM = {
  /** Between the eyebrows / top of the nose bridge. */
  BRIDGE_TOP: 168,
  BRIDGE: 6,
  NOSE_RIDGE: [197, 195, 5, 4, 1] as const,
  NOSE_TIP: 1,
  /** Temple (side of the face, where the arm passes). */
  TEMPLE_L: 127,
  TEMPLE_R: 356,
  /** In front of the ear (arm direction). */
  EAR_L: 234,
  EAR_R: 454,
  EAR_L_AUX: 93,
  EAR_R_AUX: 323,
  /** Eye corners (outer, inner) for the image-left and image-right eyes. */
  EYE_L_OUTER: 33,
  EYE_L_INNER: 133,
  EYE_R_INNER: 362,
  EYE_R_OUTER: 263,
  /** Upper / lower eyelids. */
  EYE_L_UPPER: 159,
  EYE_L_LOWER: 145,
  EYE_R_UPPER: 386,
  EYE_R_LOWER: 374,
  /** Iris centres and contours. Contour order: right, top, left, bottom (image space). */
  IRIS_L_CENTER: 468,
  IRIS_L_CONTOUR: [469, 470, 471, 472] as const,
  IRIS_R_CENTER: 473,
  IRIS_R_CONTOUR: [474, 475, 476, 477] as const,
  /** Top of the forehead / bottom of the chin. */
  FACE_TOP: 10,
  FACE_BOTTOM: 152,
  /** Face oval used for silhouette checks. */
  FACE_OVAL: [
    10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149,
    150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
  ] as const,
} as const;

export const FACE_POINT_COUNT = 468;
export const TOTAL_LANDMARK_COUNT = 478;

/** Eye contour points whose depth stands in for the iris depth (no canonical vertex exists for irises). */
export const EYE_L_RING = [33, 133, 159, 145] as const;
export const EYE_R_RING = [362, 263, 386, 374] as const;

/** Weights for the Kabsch fallback: eyes, nose and temples dominate; lips/jaw are down-weighted. */
export const KABSCH_WEIGHTS: Float32Array = (() => {
  const w = new Float32Array(FACE_POINT_COUNT).fill(0.3);
  const strong = [
    LM.BRIDGE_TOP, LM.BRIDGE, ...LM.NOSE_RIDGE, LM.TEMPLE_L, LM.TEMPLE_R, LM.EAR_L, LM.EAR_R,
    LM.EYE_L_OUTER, LM.EYE_L_INNER, LM.EYE_R_INNER, LM.EYE_R_OUTER, LM.EYE_L_UPPER, LM.EYE_L_LOWER,
    LM.EYE_R_UPPER, LM.EYE_R_LOWER, LM.FACE_TOP,
  ];
  for (const i of strong) w[i] = 1;
  for (const i of LM.FACE_OVAL) w[i] = Math.max(w[i], 0.6);
  return w;
})();
