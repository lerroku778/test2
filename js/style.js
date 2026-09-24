// Визуальный стиль игры — «мульт»: целшейдинг + контуры. Другие стили (R.E.P.O., чистый PBR) убраны.
import * as THREE from 'three';

export const STYLE = 'toon';
export const TOON = true;

// Три ступени света + мягкая тень: ровные плоские пятна, без пересветов.
let grad;
export function gradientMap() {
  if (grad) return grad;
  const steps = [72, 128, 188, 232, 255];
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  grad = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  grad.minFilter = grad.magFilter = THREE.NearestFilter;
  grad.generateMipmaps = false;
  grad.needsUpdate = true;
  return grad;
}

const TOON_KEYS = ['color', 'map', 'bumpMap', 'bumpScale', 'normalMap', 'emissive', 'emissiveIntensity', 'emissiveMap', 'transparent', 'opacity', 'side', 'flatShading', 'polygonOffset', 'polygonOffsetFactor', 'alphaTest', 'depthWrite', 'fog'];

export function toonFrom(p) {
  const q = { gradientMap: gradientMap() };
  for (const k of TOON_KEYS) if (p[k] !== undefined) q[k] = p[k];
  return new THREE.MeshToonMaterial(q);
}
