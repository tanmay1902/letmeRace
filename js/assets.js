// Loads the CC0 assets (Poly Haven) used by the game.
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const manager = new THREE.LoadingManager();
const texLoader = new THREE.TextureLoader(manager);
const cache = new Map();
export let maxAniso = 8;
export function setAniso(a) { maxAniso = a; }

export function onProgress(fn) {
  manager.onProgress = (url, loaded, total) => fn(loaded / total, url);
}

// PBR material set from a Poly Haven texture name (diff / nor / rough).
export function pbr(name, repeatU = 1, repeatV = 1, opts = {}) {
  const key = name;
  if (!cache.has(key)) {
    const load = (suf, srgb) => new Promise((res) => {
      texLoader.load(`assets/textures/${name}_${suf}.jpg`, (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = maxAniso;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        res(t);
      }, undefined, () => res(null));
    });
    cache.set(key, Promise.all([load('diff', true), load('nor', false), load('rough', false)]));
  }
  return cache.get(key).then(([map, normalMap, roughnessMap]) => {
    const clone = (t) => { if (!t) return null; const c = t.clone(); c.repeat.set(repeatU, repeatV); c.needsUpdate = true; return c; };
    return new THREE.MeshStandardMaterial({
      map: clone(map), normalMap: clone(normalMap), roughnessMap: clone(roughnessMap),
      roughness: 1, metalness: 0, ...opts,
    });
  });
}

export function loadHDR(url) {
  return new Promise((res, rej) => new RGBELoader(manager).load(url, res, undefined, rej));
}

const gltfLoader = new GLTFLoader(manager);
export function loadGLTF(url) {
  return new Promise((res, rej) => gltfLoader.load(url, res, undefined, rej));
}
