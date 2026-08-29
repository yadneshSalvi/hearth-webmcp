import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from "three";
import { applyFade, createFadeState, restoreFade } from "@/src/scene/fade";

/** Two meshes sharing one cached material, which is exactly how src/scene/materials.ts hands them out. */
function item(): { root: Group; shared: MeshStandardMaterial; meshes: Mesh[] } {
  const shared = new MeshStandardMaterial({ color: "#C46A4A", opacity: 1, transparent: false, depthWrite: true });
  const geometry = new BoxGeometry(1, 1, 1);
  const meshes = [new Mesh(geometry, shared), new Mesh(geometry, shared)];
  const root = new Group();
  const inner = new Group();
  inner.add(meshes[1] as Mesh);
  root.add(meshes[0] as Mesh, inner);
  return { root, shared, meshes };
}

describe("per-item material fade", () => {
  it("fades an item without touching the material every other item shares", () => {
    const { root, shared, meshes } = item();
    const other = new Mesh(new BoxGeometry(1, 1, 1), shared);
    const state = createFadeState();

    applyFade(state, root, 0.4);

    for (const mesh of meshes) {
      expect(mesh.material).not.toBe(shared);
      expect((mesh.material as MeshStandardMaterial).opacity).toBe(0.4);
      expect((mesh.material as MeshStandardMaterial).transparent).toBe(true);
      // A half-transparent body must not write depth, or it punches a hole in what is behind it.
      expect((mesh.material as MeshStandardMaterial).depthWrite).toBe(false);
    }
    // The shared original — and therefore every other item in the home — is untouched.
    expect(shared.opacity).toBe(1);
    expect(shared.transparent).toBe(false);
    expect(other.material).toBe(shared);
  });

  it("reuses the clones for every step of one fade", () => {
    const { root, meshes } = item();
    const state = createFadeState();
    applyFade(state, root, 0.8);
    const first = meshes[0]?.material;
    applyFade(state, root, 0.3);
    expect(meshes[0]?.material).toBe(first);
    expect((meshes[0]?.material as MeshStandardMaterial).opacity).toBe(0.3);
    expect(state.borrowed).toHaveLength(2);
  });

  it("gives the shared materials back when the fade reaches 1", () => {
    const { root, shared, meshes } = item();
    const state = createFadeState();
    applyFade(state, root, 0.2);
    applyFade(state, root, 1);
    for (const mesh of meshes) expect(mesh.material).toBe(shared);
    expect(state.borrowed).toHaveLength(0);
  });

  it("clones nothing at all when there is nothing to fade", () => {
    const { root, shared, meshes } = item();
    const state = createFadeState();
    applyFade(state, root, 1);
    expect(state.borrowed).toHaveLength(0);
    for (const mesh of meshes) expect(mesh.material).toBe(shared);
  });

  it("restores on unmount, mid-fade", () => {
    const { root, shared, meshes } = item();
    const state = createFadeState();
    applyFade(state, root, 0.5);
    restoreFade(state);
    for (const mesh of meshes) expect(mesh.material).toBe(shared);
    expect(state.borrowed).toHaveLength(0);
  });

  it("survives a target that has not mounted yet", () => {
    const state = createFadeState();
    expect(() => applyFade(state, null, 0.5)).not.toThrow();
    expect(state.borrowed).toHaveLength(0);
  });
});
