"""Generic skull + ear occluder mesh around the MediaPipe canonical face → GLB.

The face mesh (468 points) has no skull or ears, so the far-side temple would float
outside the head silhouette. This proxy is rendered depth-only by the runtime
(src/platform/render/headOccluder.ts), attached to the face matrix and scaled in X so
that its half-width at ear level sits just inside the temple arms.

Design (glTF axes, mm, same frame as the canonical model: +Y up, +Z toward camera):
  skull  ellipsoid radii (80, 95, 88) centred at (0, 15, −50) — verified to stay ≥ 3 mm
         behind the canonical face surface wherever the face mesh exists (eye sockets are the
         tightest spot) and ~2.5 mm inside the face silhouette at the temple landmarks
  ears   ellipsoids radii (7, 20, 14) centred 3 mm outside the skull at (y 15, z −45): the
         temple arm rests on the ear root (top at y = 35) and disappears behind the ear

Usage (headless):
  Blender -b --python scripts/blender/head_builder.py -- --face public/models/canonical_face_model.obj --out public/models/head_occluder.glb
Usage (MCP): set HEAD_BUILDER_NO_MAIN = True before exec, then call build_head(face_obj_or_None, out_path).
"""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector

SKULL_CENTER = (0.0, 15.0, -50.0)
SKULL_RADII = (80.0, 95.0, 88.0)
EAR_PROTRUSION = 3.0       # ear centre sits this far outside the skull surface (ears stick out ~10 mm)
EAR_CENTER = (15.0, -45.0)  # y, z
EAR_RADII = (7.0, 20.0, 14.0)
EAR_LEVEL = (37.0, -40.0)  # y, z where the runtime measures the skull half-width


def G(x, y, z):
    return Vector((x, -z, y))


def ellipsoid(bm, center, radii, segments, rings):
    verts = bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)['verts']
    for v in verts:
        # UV sphere axis is Blender Z (= glTF Y): keep the poles top/bottom.
        v.co = Vector((v.co.x * radii[0], v.co.y * radii[2], v.co.z * radii[1])) + G(*center)
    return verts


def load_face(path):
    """Imports the canonical OBJ (cm) as a mm mesh in glTF-import axes; returns the object."""
    bpy.ops.wm.obj_import(filepath=path)
    ob = bpy.context.selected_objects[0]
    ob.name = 'canonical_face'
    # The importer puts its axis conversion / scale on the object; bake a clean mm mesh instead.
    for v in ob.data.vertices:
        x, y, z = v.co  # raw OBJ: x, y up, z front (cm)
        v.co = Vector((x * 10, -z * 10, y * 10))
    ob.matrix_world.identity()
    ob.data.update()
    return ob


def verify_behind_face(skull_obj, face_obj, min_gap=1.0):
    """Every skull vertex whose forward ray (toward +Z glTF = −Y Blender) hits the face must
    lie behind that hit by ≥ min_gap. Returns (ok, worst_gap, count_checked)."""
    import mathutils
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = mathutils.bvhtree.BVHTree.FromObject(face_obj, dg)
    worst = float('inf')
    checked = 0
    for v in skull_obj.data.vertices:
        p = skull_obj.matrix_world @ v.co
        hit = bvh.ray_cast(p, Vector((0, -1, 0)), 400)
        if hit[0] is None:
            continue
        checked += 1
        gap = (hit[0] - p).length
        worst = min(worst, gap)
    return worst >= min_gap, worst, checked


def build_head(face_obj, out_path):
    bm = bmesh.new()
    skull = ellipsoid(bm, SKULL_CENTER, SKULL_RADII, 48, 32)
    # Reference half-width at the ear level (runtime scales X so this lands just inside the temples).
    half = 0.0
    for v in skull:
        gx, gy, gz = v.co.x, v.co.z, -v.co.y
        if abs(gy - EAR_LEVEL[0]) < 4 and abs(gz - EAR_LEVEL[1]) < 6:
            half = max(half, abs(gx))
    ear_x = half + EAR_PROTRUSION
    for sx in (-1, 1):
        ellipsoid(bm, (sx * ear_x, EAR_CENTER[0], EAR_CENTER[1]), EAR_RADII, 20, 14)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('head_occluder')
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new('head_occluder', me)
    bpy.context.scene.collection.objects.link(ob)

    report = {'half_width_at_ear_level_mm': round(half, 2), 'ear_center_x_mm': round(ear_x, 2), 'triangles': len(me.polygons)}
    if face_obj is not None:
        ok, worst, n = verify_behind_face(ob, face_obj)
        report.update({'behind_face_ok': ok, 'min_gap_mm': round(worst, 2), 'checked': n})

    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    kwargs = dict(filepath=out_path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                  export_materials='NONE', export_animations=False, export_skins=False, export_morph=False,
                  export_cameras=False, export_lights=False, export_extras=False)
    try:
        bpy.ops.export_scene.gltf(**kwargs, export_texcoords=False, export_normals=False)
    except TypeError:
        bpy.ops.export_scene.gltf(**kwargs)
    report['glb'] = out_path
    report['bytes'] = os.path.getsize(out_path)
    print('[head_builder]', report)
    return ob, report


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    face_path, out_path = None, 'public/models/head_occluder.glb'
    i = 0
    while i < len(argv):
        if argv[i] == '--face':
            face_path = argv[i + 1]; i += 2
        elif argv[i] == '--out':
            out_path = argv[i + 1]; i += 2
        else:
            i += 1
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    face = load_face(face_path) if face_path and os.path.exists(face_path) else None
    _, rep = build_head(face, out_path)
    if face is not None and not rep.get('behind_face_ok', True):
        raise SystemExit(f"head occluder pokes through the face: min gap {rep['min_gap_mm']} mm")


if not globals().get('HEAD_BUILDER_NO_MAIN'):
    main()
