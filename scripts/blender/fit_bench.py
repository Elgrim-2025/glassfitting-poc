"""Face-variant fit bench in Blender: ground-truth clearance check + renders.

Reads bench/fit-bench.json written by `npm run bench:fit` (scripts/fit-bench.ts). For every
variant it builds the deformed face mesh (true geometry) and, per case, places the frame
GLB with the matrix the fitting core produced, applies the temple splay, and measures the
minimum signed distance of each part to the face surface with a BVH. Also renders a front
and a yaw-30° view per variant into bench/renders/.

Pass criteria (mm, negative = inside the skin):
  temples ≥ −0.5   rims (frame_front) ≥ −0.5   lenses ≥ 0   nose pads ≥ −1.5 (pads press the skin)

Usage (headless):
  Blender -b --python scripts/blender/fit_bench.py -- --bench bench/fit-bench.json [--renders bench/renders] [--frame FR-0001] [--no-render]
Usage (MCP): set FIT_BENCH_NO_MAIN = True before exec, then run_bench(bench_json, renders_dir).
"""
import bpy
import bmesh
import json
import math
import os
import sys
import mathutils
from mathutils import Euler, Matrix, Vector

TOLERANCE = {'temple_L': -0.5, 'temple_R': -0.5, 'frame_front': -0.5, 'lens_L': 0.0, 'lens_R': 0.0, 'nose_pads': -1.5}
# Only vertices in front of the face-mesh boundary can be judged against an open face shell.
JUDGE_MIN_Z = -28.0


def G(x, y, z):
    return Vector((x, -z, y))


def gltf_matrix_to_blender(m16):
    """Column-major glTF 4×4 (face-local) → Blender Matrix in the glTF-import convention."""
    M = Matrix(((m16[0], m16[4], m16[8], m16[12]),
                (m16[1], m16[5], m16[9], m16[13]),
                (m16[2], m16[6], m16[10], m16[14]),
                (m16[3], m16[7], m16[11], m16[15])))
    C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # glTF → Blender
    return C @ M @ C.inverted()


def load_canonical_triangles(obj_path):
    tris = []
    with open(obj_path) as f:
        for line in f:
            if line.startswith('f '):
                idx = [int(p.split('/')[0]) - 1 for p in line.split()[1:]]
                for k in range(1, len(idx) - 1):
                    tris.append((idx[0], idx[k], idx[k + 1]))
    return tris


def make_face(name, vertices, triangles, material):
    bm = bmesh.new()
    verts = [bm.verts.new(G(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2])) for i in range(len(vertices) // 3)]
    for a, b, c in triangles:
        try:
            bm.faces.new((verts[a], verts[b], verts[c]))
        except ValueError:
            pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def import_frame(glb_path):
    bpy.ops.import_scene.gltf(filepath=glb_path)
    objs = list(bpy.context.selected_objects)
    root = next(o for o in objs if o.parent is None)
    return root, objs


def hierarchy(root):
    out = []
    def rec(o):
        out.append(o)
        for c in o.children:
            rec(c)
    rec(root)
    return out


def place(root, objs, glasses_local, splay):
    root.matrix_world = gltf_matrix_to_blender(glasses_local)
    by = {o.name.split('.')[0]: o for o in objs}
    for name, sign, ang in (('temple_L', -1, splay[0]), ('temple_R', 1, splay[1])):
        t = by[name]
        h = by['anchor_temple_' + name[-1]].matrix_local.translation
        rot = Matrix.Translation(h) @ Matrix.Rotation(ang if sign < 0 else -ang, 4, 'Z') @ Matrix.Translation(-h)
        t.matrix_parent_inverse = Matrix.Identity(4)
        t.matrix_basis = rot
    bpy.context.view_layer.update()


def min_signed_distance(part, bvh):
    m = part.matrix_world
    worst, where = float('inf'), None
    for v in part.data.vertices:
        p = m @ v.co
        if -p.y < JUDGE_MIN_Z:  # behind the face shell: not judged
            continue
        loc, nrm, idx, dist = bvh.find_nearest(p, 60.0)
        if loc is None:
            continue
        sd = (p - loc).dot(nrm)
        if sd < worst:
            worst, where = sd, (round(p.x, 1), round(p.z, 1), round(-p.y, 1))
    return (None if worst == float('inf') else worst), where


def setup_render(scene, renders_dir):
    if 'BenchCam' not in bpy.data.objects:
        cam = bpy.data.objects.new('BenchCam', bpy.data.cameras.new('BenchCam'))
        scene.collection.objects.link(cam)
    cam = bpy.data.objects['BenchCam']
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.lens_unit = 'FOV'
    cam.data.angle = math.radians(38)
    cam.data.clip_start = 10
    cam.data.clip_end = 5000
    scene.camera = cam
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_shadows = False
    scene.render.resolution_x = 640
    scene.render.resolution_y = 480
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    os.makedirs(renders_dir, exist_ok=True)
    return cam


def shoot(scene, cam, path, yaw_deg, dist=430, height=15):
    a = math.radians(yaw_deg)
    cam.location = Vector((-dist * math.sin(a), -dist * math.cos(a), height))
    cam.rotation_euler = Euler((math.radians(90), 0, -a))
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def run_bench(bench_path, renders_dir=None, only_frame=None, render=True, verbose=False):
    with open(bench_path) as f:
        bench = json.load(f)
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(bench_path)))
    tris = load_canonical_triangles(os.path.join(root_dir, 'public', 'models', 'canonical_face_model.obj'))
    scene = bpy.context.scene
    skin = bpy.data.materials.get('bench_skin') or bpy.data.materials.new('bench_skin')
    skin.diffuse_color = (0.85, 0.62, 0.5, 1)
    cam = setup_render(scene, renders_dir or os.path.join(root_dir, 'bench', 'renders')) if render else None

    frames = {f['frame_id']: f for f in bench['frames']}
    loaded = {}
    for fid, f in frames.items():
        if only_frame and fid != only_frame:
            continue
        glb = f['glb'] if os.path.isabs(f['glb']) else os.path.join(root_dir, f['glb'])
        root, objs = import_frame(glb)
        root.hide_render = True
        for o in objs:
            o.hide_render = True
        loaded[fid] = (root, objs)

    results = []
    for variant in bench['variants']:
        face = make_face(f"face_{variant['name']}", variant['vertices'], tris, skin)
        dg = bpy.context.evaluated_depsgraph_get()
        bvh = mathutils.bvhtree.BVHTree.FromObject(face, dg)
        for case in variant['cases']:
            fid = case['frame_id']
            if fid not in loaded:
                continue
            root, objs = loaded[fid]
            for o in objs:
                o.hide_render = False
            place(root, objs, case['glassesLocal'], case['splay'])
            parts = {}
            ok = True
            for o in objs:
                base = o.name.split('.')[0]
                if o.type != 'MESH' or base not in TOLERANCE:
                    continue
                sd, where = min_signed_distance(o, bvh)
                parts[base] = None if sd is None else round(sd, 2)
                if sd is not None and sd < TOLERANCE[base]:
                    ok = False
                    if verbose:
                        print(f"  FAIL {variant['name']} {case['pose']} {fid} {base}: {sd:.2f} mm at {where}")
            res = {'variant': variant['name'], 'pose': case['pose'], 'frame_id': fid, 'ok': ok, 'parts': parts,
                   'forwardMm': case.get('forwardMm'), 'splayDeg': [round(math.degrees(s), 1) for s in case['splay']],
                   'corePenetration': case.get('penetration')}
            results.append(res)
            if render and case['pose'].get('yawDeg', 0) == 0 and case['pose'].get('pitchDeg', 0) == 0 and fid == (only_frame or bench['frames'][0]['frame_id']):
                shoot(scene, cam, os.path.join(renders_dir, f"{variant['name']}_front.png"), 0)
                shoot(scene, cam, os.path.join(renders_dir, f"{variant['name']}_yaw30.png"), 32)
            for o in objs:
                o.hide_render = True
        bpy.data.objects.remove(face, do_unlink=True)

    fails = [r for r in results if not r['ok']]
    print(f"[fit_bench] cases {len(results)}, failed {len(fails)}")
    for r in fails:
        print(f"  {r['variant']:16s} {r['pose']} {r['frame_id']} parts={r['parts']}")
    worst = {}
    for r in results:
        for k, v in r['parts'].items():
            if v is not None and (k not in worst or v < worst[k]):
                worst[k] = v
    print('[fit_bench] worst signed distance per part (mm):', worst)
    out_path = os.path.join(os.path.dirname(os.path.abspath(bench_path)), 'fit-bench-blender.json')
    with open(out_path, 'w') as f:
        json.dump({'results': results, 'worst': worst, 'tolerance': TOLERANCE}, f, indent=1)
    print('[fit_bench] wrote', out_path)
    return results


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    bench, renders, frame, render = 'bench/fit-bench.json', None, None, True
    i = 0
    while i < len(argv):
        if argv[i] == '--bench':
            bench = argv[i + 1]; i += 2
        elif argv[i] == '--renders':
            renders = argv[i + 1]; i += 2
        elif argv[i] == '--frame':
            frame = argv[i + 1]; i += 2
        elif argv[i] == '--no-render':
            render = False; i += 1
        else:
            i += 1
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    results = run_bench(bench, renders or os.path.join(os.path.dirname(os.path.abspath(bench)), 'renders'), frame, render, verbose=True)
    if any(not r['ok'] for r in results):
        raise SystemExit('fit bench failed')


if not globals().get('FIT_BENCH_NO_MAIN'):
    main()
