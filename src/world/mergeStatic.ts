import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

interface Bucket {
  material: THREE.Material;
  castShadow: boolean;
  receiveShadow: boolean;
  renderOrder: number;
  geometries: THREE.BufferGeometry[];
  meshes: THREE.Mesh[];
}

function excluded(mesh: THREE.Mesh, root: THREE.Object3D) {
  let object: THREE.Object3D | null = mesh;
  while (object && object !== root) {
    if (object.userData.staticMergeExclude) return true;
    object = object.parent;
  }
  return false;
}

function attributesKey(geometry: THREE.BufferGeometry) {
  return Object.keys(geometry.attributes)
    .sort()
    .map((key) => {
      const attribute = geometry.getAttribute(key);
      return `${key}:${attribute.itemSize}:${attribute.normalized}`;
    })
    .join(',');
}

export function mergeStaticMeshes(root: THREE.Object3D) {
  root.updateWorldMatrix(true, true);
  const inverseRoot = root.matrixWorld.clone().invert();
  const buckets = new Map<string, Bucket>();
  root.traverse((object) => {
    if (!(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;
    const material = mesh.material;
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    if (!position) return;
    const positionUsage = 'data' in position ? position.data.usage : position.usage;
    if (
      (mesh as THREE.InstancedMesh).isInstancedMesh ||
      (mesh as THREE.SkinnedMesh).isSkinnedMesh ||
      Array.isArray(material) ||
      !mesh.visible ||
      excluded(mesh, root) ||
      Object.keys(geometry.morphAttributes).length > 0 ||
      positionUsage === THREE.DynamicDrawUsage ||
      material.transparent ||
      material.opacity < 1 ||
      material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ||
      mesh.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender
    ) {
      return;
    }
    const relative = inverseRoot.clone().multiply(mesh.matrixWorld);
    if (relative.determinant() < 0) return;
    const key = [
      material.uuid,
      mesh.castShadow,
      mesh.receiveShadow,
      mesh.renderOrder,
      attributesKey(geometry),
    ].join('|');
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        material,
        castShadow: mesh.castShadow,
        receiveShadow: mesh.receiveShadow,
        renderOrder: mesh.renderOrder,
        geometries: [],
        meshes: [],
      };
      buckets.set(key, bucket);
    }
    let transformed = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    transformed.clearGroups();
    transformed.applyMatrix4(relative);
    bucket.geometries.push(transformed);
    bucket.meshes.push(mesh);
  });

  const removed: THREE.Mesh[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.meshes.length < 2) {
      for (const geometry of bucket.geometries) geometry.dispose();
      continue;
    }
    const merged = mergeGeometries(bucket.geometries, false);
    for (const geometry of bucket.geometries) geometry.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, bucket.material);
    mesh.castShadow = bucket.castShadow;
    mesh.receiveShadow = bucket.receiveShadow;
    mesh.renderOrder = bucket.renderOrder;
    mesh.name = `${root.name}-merged`;
    root.add(mesh);
    removed.push(...bucket.meshes);
  }

  for (const mesh of removed) mesh.parent?.remove(mesh);
}
