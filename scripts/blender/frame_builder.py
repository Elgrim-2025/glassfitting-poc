"""Parametric eyeglass-frame modelling in Blender → GLB (docs/assets/glb-spec.md).

Reads scripts/frames.json and builds each frame from its spec (mm): flat-profile rims
swept around the lens outline, curved lenses, bridge, end pieces with hinges, tapered
temples that bend behind the ear, and nose pads. Node names follow the asset spec so the
runtime rig (src/platform/render/glasses.ts) and the clearance solver can use them.

Coordinates: glTF axes are +Y up, +Z toward the camera, origin at the bridge nose contact.
Blender is Z-up, so a glTF point (x, y, z) is modelled at Blender (x, -z, y); the default
"+Y up" export maps it back.

Usage (headless):
  Blender -b --python scripts/blender/frame_builder.py -- --frames scripts/frames.json --out public/assets/frames [--only FR-0001]
Usage (Blender MCP / interactive): set FRAME_BUILDER_NO_MAIN = True before exec'ing this
file, then call build_all(defs, out_dir) or build_frame(def).
"""
import bpy
import bmesh
import json
import math
import os
import sys
from mathutils import Vector

# ---------------------------------------------------------------------------
# Coordinates and 2-D outlines
# ---------------------------------------------------------------------------

def G(x, y, z):
    """glTF (x, y, z) → Blender vector."""
    return Vector((x, -z, y))


def rounded_rect(w, h, r, n_corner=6, r_bottom=None):
    """Closed CCW polyline (list of (x, y)) of a w×h rectangle centred at the origin with
    rounded corners (radius r on top, r_bottom on the bottom)."""
    rb = r if r_bottom is None else r_bottom
    hw, hh = w / 2, h / 2
    pts = []

    def arc(cx, cy, rad, a0, a1):
        for k in range(n_corner + 1):
            a = a0 + (a1 - a0) * k / n_corner
            pts.append((cx + rad * math.cos(a), cy + rad * math.sin(a)))

    arc(hw - r, hh - r, r, 0, math.pi / 2)              # top-right
    arc(-hw + r, hh - r, r, math.pi / 2, math.pi)       # top-left
    arc(-hw + rb, -hh + rb, rb, math.pi, 1.5 * math.pi)  # bottom-left
    arc(hw - rb, -hh + rb, rb, 1.5 * math.pi, 2 * math.pi)  # bottom-right
    return dedupe(pts)


def ellipse(w, h, n=96):
    return [(w / 2 * math.cos(2 * math.pi * k / n), h / 2 * math.sin(2 * math.pi * k / n)) for k in range(n)]


def bezier(p0, p1, p2, p3, n):
    out = []
    for k in range(n):
        t = k / n
        u = 1 - t
        out.append((
            u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
        ))
    return out


def aviator(w, h, n=28):
    """Tear-drop aviator lens: wide flat top, rounded bottom (same control points as
    scripts/lib/frame-geometry.mjs so the procedural fallback matches). CCW."""
    hw, hh = w / 2, h / 2
    pts = []
    pts += bezier((-hw, hh * 0.55), (-hw, hh), (-hw * 0.3, hh), (0, hh), n)
    pts += bezier((0, hh), (hw * 0.6, hh), (hw, hh * 0.7), (hw, hh * 0.2), n)
    pts += bezier((hw, hh * 0.2), (hw, -hh * 0.5), (hw * 0.55, -hh), (0, -hh), n)
    pts += bezier((0, -hh), (-hw * 0.7, -hh), (-hw, -hh * 0.4), (-hw, hh * 0.55), n)
    pts = dedupe(pts)
    return pts if signed_area(pts) > 0 else list(reversed(pts))


def signed_area(pts):
    a = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        a += x0 * y1 - x1 * y0
    return a / 2


def dedupe(pts, eps=1e-6):
    out = []
    for p in pts:
        if not out or (abs(p[0] - out[-1][0]) > eps or abs(p[1] - out[-1][1]) > eps):
            out.append(p)
    if len(out) > 1 and abs(out[0][0] - out[-1][0]) < eps and abs(out[0][1] - out[-1][1]) < eps:
        out.pop()
    return out


def resample_closed(pts, spacing):
    """Evenly spaced points along a closed polyline."""
    n = len(pts)
    seg = []
    total = 0.0
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        d = math.hypot(x1 - x0, y1 - y0)
        seg.append(d)
        total += d
    count = max(12, int(round(total / spacing)))
    step = total / count
    out = []
    i, acc = 0, 0.0
    for k in range(count):
        target = k * step
        while acc + seg[i] < target - 1e-9:
            acc += seg[i]
            i = (i + 1) % n
        t = 0 if seg[i] == 0 else (target - acc) / seg[i]
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        out.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
    return out


def offset_closed(pts, dist):
    """Offset a closed CCW polyline outward by dist (bisector method)."""
    n = len(pts)
    out = []
    for i in range(n):
        x0, y0 = pts[i - 1]
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        d0 = Vector((x1 - x0, y1 - y0)).normalized()
        d1 = Vector((x2 - x1, y2 - y1)).normalized()
        n0 = Vector((d0.y, -d0.x))  # outward normal for CCW
        n1 = Vector((d1.y, -d1.x))
        bis = (n0 + n1)
        if bis.length < 1e-6:
            bis = n1
        bis.normalize()
        cos_half = max(0.3, bis.dot(n1))
        out.append((x1 + bis.x * dist / cos_half, y1 + bis.y * dist / cos_half))
    return out


def lens_outline(shape, w, h):
    if shape == 'round':
        return ellipse(w, h, 96)
    if shape == 'aviator':
        return aviator(w, h)
    return rounded_rect(w, h, min(9, w * 0.17), 8, r_bottom=min(12, w * 0.22))


# ---------------------------------------------------------------------------
# Profiles and sweeps
# ---------------------------------------------------------------------------

def profile_rect(w, h, r, seg=3):
    """Rounded rectangle in the (u, v) profile plane, CCW."""
    r = min(r, w / 2 - 1e-3, h / 2 - 1e-3)
    return rounded_rect(w, h, r, seg)


def profile_circle(d, n=14):
    return [(d / 2 * math.cos(2 * math.pi * k / n), d / 2 * math.sin(2 * math.pi * k / n)) for k in range(n)]


def sweep(bm, path, profile, up, closed=False, taper=None, outward=None):
    """Sweep a 2-D profile along a 3-D path (Blender coords).

    Frame at each point: t = tangent, n = normalize(t × up) (profile u axis), b = n × t (v).
    `outward`, when given (Blender vector, the outline centre), flips n to point away from it.
    `taper(i, s)` returns (su, sv) profile scale at path index i / arc length s.
    """
    N = len(path)
    rings = []
    s = 0.0
    for i in range(N):
        if closed:
            t = (path[(i + 1) % N] - path[i - 1]).normalized()
        elif i == 0:
            t = (path[1] - path[0]).normalized()
        elif i == N - 1:
            t = (path[N - 1] - path[N - 2]).normalized()
        else:
            t = (path[i + 1] - path[i - 1]).normalized()
        if i > 0:
            s += (path[i] - path[i - 1]).length
        n = t.cross(up)
        if n.length < 1e-6:
            n = t.cross(Vector((1, 0, 0)))
        n.normalize()
        if outward is not None and n.dot(path[i] - outward) < 0:
            n = -n
        b = n.cross(t).normalized()
        su, sv = taper(i, s) if taper else (1.0, 1.0)
        ring = [bm.verts.new(path[i] + n * (u * su) + b * (v * sv)) for (u, v) in profile]
        rings.append(ring)
    M = len(profile)
    faces = []
    last = N if closed else N - 1
    for i in range(last):
        r0, r1 = rings[i], rings[(i + 1) % N]
        for k in range(M):
            faces.append(bm.faces.new((r0[k], r0[(k + 1) % M], r1[(k + 1) % M], r1[k])))
    if not closed:
        faces.append(bm.faces.new(rings[0]))
        faces.append(bm.faces.new(list(reversed(rings[-1]))))
    return faces


def ellipsoid(bm, center, radii, rot=None, segments=20, rings=12):
    """UV ellipsoid; rot is a Blender Matrix (3×3) applied before translation."""
    verts = bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)['verts']
    for v in verts:
        p = Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2]))
        if rot is not None:
            p = rot @ p
        v.co = p + center
    return verts


def finish_mesh(name, bm, material, smooth=True):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = smooth
    me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def empty(name, loc):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = 2
    ob.empty_display_type = 'PLAIN_AXES'
    ob.location = loc
    bpy.context.scene.collection.objects.link(ob)
    return ob


def make_material(name, color, metallic, roughness, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (color[0], color[1], color[2], 1.0)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Alpha'].default_value = alpha
    if alpha < 1.0 and hasattr(m, 'surface_render_method'):
        m.surface_render_method = 'BLENDED'
    m.use_backface_culling = False
    m.diffuse_color = (color[0], color[1], color[2], alpha)  # workbench preview
    m.metallic = metallic
    m.roughness = roughness
    return m


# ---------------------------------------------------------------------------
# Frame parts
# ---------------------------------------------------------------------------

def build_frame(d):
    """Builds one frame; returns (root_empty, report dict)."""
    spec, b = d['spec'], d['build']
    lw, bw, tl, lh, fw = spec['lens_width_mm'], spec['bridge_mm'], spec['temple_mm'], spec['lens_height_mm'], spec['frame_width_mm']
    metal = d['style'] == 'metal'
    lens_z = b['lens_plane_mm']
    rim_w, rim_d, rim_r = b['rim_width_mm'], b['rim_depth_mm'], b['rim_bevel_mm']
    lens_cy = b['lens_center_y_mm']
    lens_cx = bw / 2 + lw / 2
    top_y = lens_cy + lh / 2
    bridge_y = lens_cy + lh * b['bridge_height_ratio']
    hinge_y, hinge_z = b['hinge_y_mm'], b['hinge_z_mm']
    hinge_x = fw / 2 - b.get('hinge_inset_mm', 0)
    end_mm = b['endpiece_mm']
    bend, drop, hook = b.get('temple_bend_mm', round(tl * 0.68)), b.get('temple_drop_mm', 28), b.get('temple_hook_mm', 2)
    sec, tip = b['temple_section_mm'], b['temple_tip_section_mm']
    pad_c, pad_s = b['pad_center'], b['pad_size_mm']
    pad_tilt = math.radians(b.get('pad_tilt_deg', 0))

    frame_mat = make_material(f"{d['frame_id']}_frame", d['color'], d['metallic'], d['roughness'])
    lens_mat = make_material(f"{d['frame_id']}_lens", d['lens_tint'], 0.0, 0.05, d['lens_alpha'])
    pad_mat = make_material(f"{d['frame_id']}_pad", (0.92, 0.92, 0.92), 0.0, 0.5, 0.6)

    root = empty(d['frame_id'], Vector((0, 0, 0)))
    rim_profile = profile_rect(rim_w, rim_d, rim_r)
    rim_z = lens_z - rim_d / 2 + 1.0  # rim front 1 mm proud of the lens plane
    front_bm = bmesh.new()
    lenses = []
    rim_paths = {}

    for side in (-1, 1):
        outline = lens_outline(d['shape'], lw, lh)
        outline = [(side * x, y) for (x, y) in outline]
        if side < 0:
            outline = list(reversed(outline))  # keep CCW after mirroring
        centre_pts = resample_closed(offset_closed(outline, rim_w / 2), 1.2)
        path = [G(side * lens_cx + x, lens_cy + y, rim_z) for (x, y) in centre_pts]
        rim_paths[side] = centre_pts
        sweep(front_bm, path, rim_profile, up=G(0, 0, 1), closed=True, outward=G(side * lens_cx, lens_cy, rim_z))

        # Lens: filled outline, spherical sag (4-base ≈ R 130 mm), 0.8 mm behind the rim front.
        lb = bmesh.new()
        inner = resample_closed(outline, 2.0)
        verts = [lb.verts.new(G(side * lens_cx + x, lens_cy + y, lens_z)) for (x, y) in inner]
        lb.faces.new(verts)
        bmesh.ops.triangulate(lb, faces=lb.faces[:])
        for _ in range(3):
            bmesh.ops.subdivide_edges(lb, edges=lb.edges[:], cuts=1, use_grid_fill=True)
        bmesh.ops.triangulate(lb, faces=lb.faces[:])
        R = 130.0
        cx, cy = side * lens_cx, lens_cy
        for v in lb.verts:
            gx, gy = v.co.x, v.co.z
            r2 = (gx - cx) ** 2 + (gy - cy) ** 2
            sag = R - math.sqrt(max(0.0, R * R - r2))
            edge_r2 = (lw / 2) ** 2
            edge_sag = R - math.sqrt(max(0.0, R * R - edge_r2))
            v.co.y = -(lens_z - 0.8 + (edge_sag - sag))
        lenses.append(finish_mesh('lens_L' if side < 0 else 'lens_R', lb, lens_mat))

        # End piece: a rounded block that thickens the rim's outer side and carries the hinge.
        # Its outer face is at ±frame_width/2; it reaches back past the hinge axis so the
        # temple root emerges from its back face.
        x_out = side * fw / 2
        z_front = rim_z + rim_d / 2
        rim_edge_x = side * (lens_cx + rim_edge_at(outline, hinge_y - lens_cy, rim_w))
        if not metal:
            depth = end_mm + 2
            ep = profile_rect(depth, end_mm, min(1.5, end_mm * 0.25))
            x_in = rim_edge_x - side * 3
            box = [G(x_in, hinge_y, z_front - depth / 2), G(x_out, hinge_y, z_front - depth / 2)]
            sweep(front_bm, box, ep, up=G(0, 1, 0))
        else:
            # Wire strut from the rim to a small hinge block at the outer edge.
            block_w = end_mm * 0.8
            strut = [G(rim_edge_x - side * 1.0, hinge_y, rim_z), G(x_out - side * block_w * 0.5, hinge_y, rim_z)]
            sweep(front_bm, strut, profile_circle(1.8), up=G(0, 1, 0))
            depth = end_mm * 0.7
            ep = profile_rect(depth, end_mm * 0.9, 0.8)
            box = [G(x_out - side * block_w, hinge_y, z_front - depth / 2), G(x_out, hinge_y, z_front - depth / 2)]
            sweep(front_bm, box, ep, up=G(0, 1, 0))
        # Hinge knuckle (visible barrel on metal frames).
        if metal:
            kb = bmesh.new()
            ellipsoid(kb, G(side * hinge_x, hinge_y, hinge_z - 1.0), (1.2, 3.0, 1.2), segments=14, rings=8)
            kb_faces = kb.faces[:]
            bmesh.ops.recalc_face_normals(kb, faces=kb_faces)
            for v in kb.verts:
                front_bm.verts.new(v.co)
            front_bm.verts.ensure_lookup_table()
            base = len(front_bm.verts) - len(kb.verts)
            kb.verts.ensure_lookup_table()
            for f in kb_faces:
                front_bm.faces.new([front_bm.verts[base + v.index] for v in f.verts])
            kb.free()

    # Bridge: arch between the rims at bridge_y, embedded into both rims.
    inner_left = -(bw / 2) - rim_w
    arch = [G(inner_left * (1 - t) + (-inner_left) * t, bridge_y + b['bridge_arch_mm'] * math.sin(math.pi * t) * 1.0, rim_z) for t in [k / 24 for k in range(25)]]
    bridge_profile = rim_profile if not metal else profile_circle(1.8)
    sweep(front_bm, arch, bridge_profile, up=G(0, 0, 1))
    if b.get('double_bridge_mm'):
        y2 = bridge_y + b['double_bridge_mm']
        bar = [G(inner_left * 1.15 * (1 - t) + (-inner_left) * 1.15 * t, y2 + 1.0 * math.sin(math.pi * t), rim_z) for t in [k / 16 for k in range(17)]]
        sweep(front_bm, bar, profile_circle(1.6), up=G(0, 0, 1))
    front = finish_mesh('frame_front', front_bm, frame_mat)

    # Temples: straight to the ear bend, then a smooth drop with a slight inward hook.
    temples = []
    for side in (-1, 1):
        tb = bmesh.new()
        x0 = side * hinge_x
        z0 = hinge_z
        p0 = G(x0, hinge_y, z0 - bend)
        p3 = G(x0 - side * hook, hinge_y - drop, z0 - bend - (tl - bend) * 0.62)
        p1 = G(x0, hinge_y, z0 - bend - 16)
        p2 = G(x0 - side * hook * 0.6, hinge_y - drop + 16, z0 - bend - (tl - bend) * 0.62 + 5)
        curve = [bezier3(p0, p1, p2, p3, k / 26) for k in range(27)]
        straight = [G(x0, hinge_y, z0 - s) for s in [j * 4.0 for j in range(int(bend / 4.0))]]
        path = straight + curve
        length = sum((path[i] - path[i - 1]).length for i in range(1, len(path)))
        if metal:
            # Wire arm, then an acetate ear tip for the last 40 mm.
            wire_end = length - 40
            wpath = [p for p, s in zip(path, arclens(path)) if s <= wire_end + 2]
            sweep(tb, wpath, profile_circle(sec[0]), up=G(0, 1, 0))
            tpath = [p for p, s in zip(path, arclens(path)) if s >= wire_end - 2]
            sweep(tb, tpath, profile_rect(tip[1], tip[0], 0.8), up=G(0, 1, 0))
        else:
            def taper(i, s, L=length):
                t = min(1.0, max(0.0, s / L))
                return ((sec[1] + (tip[1] - sec[1]) * t) / sec[1], (sec[0] + (tip[0] - sec[0]) * t) / sec[0])
            sweep(tb, path, profile_rect(sec[1], sec[0], 0.8), up=G(0, 1, 0), taper=taper)
        temples.append(finish_mesh('temple_L' if side < 0 else 'temple_R', tb, frame_mat))

    # Nose pads.
    pb = bmesh.new()
    for side in (-1, 1):
        c = G(side * pad_c[0], pad_c[1], pad_c[2])
        rot = (Vector((0, 0, 1)).to_track_quat('Y', 'Z').to_matrix())
        from mathutils import Matrix
        # Pad faces the nose: rotate about the vertical (Blender Z) axis so its thin axis points inward-back.
        m = Matrix.Rotation(-side * pad_tilt, 3, 'Z') @ Matrix.Rotation(math.radians(8) * side, 3, 'Y')
        if metal:
            ellipsoid(pb, c, (pad_s[2] / 2, pad_s[0] / 2, pad_s[1] / 2), rot=m, segments=16, rings=10)
            inner_x = side * (lens_cx - rim_edge_at(outline, pad_c[1] + 2 - lens_cy, rim_w * 0.5))
            arm_from = G(inner_x, pad_c[1] + 2, rim_z)
            arm_to = c + G(side * 0.8, 1.0, 0.6) - G(0, 0, 0)
            arm = smooth_path([arm_from, G(inner_x - side * 1.5, pad_c[1] + 2.5, rim_z - 2.5), arm_to], 4)
            sweep(pb, arm, profile_circle(1.0), up=G(0, 0, 1))
        else:
            ellipsoid(pb, c, (pad_s[2] / 2 + 0.6, pad_s[0] / 2, pad_s[1] / 2), rot=m, segments=16, rings=10)
    pads = finish_mesh('nose_pads', pb, pad_mat)

    anchors = [
        empty('anchor_bridge', Vector((0, 0, 0))),
        empty('anchor_temple_L', G(-hinge_x, hinge_y, hinge_z)),
        empty('anchor_temple_R', G(hinge_x, hinge_y, hinge_z)),
    ]
    for ob in [front, pads] + lenses + temples + anchors:
        ob.parent = root

    report = {
        'frame_id': d['frame_id'],
        'front_width_mm': front.dimensions.x,
        'lens_width_mm': lenses[0].dimensions.x,
        'triangles': sum(len(o.data.polygons) for o in [front, pads] + lenses + temples),
        'hinge': [hinge_x, hinge_y, hinge_z],
    }
    return root, report


def rim_edge_at(outline, y, rim_w):
    """Outermost |x| of the lens outline (already mirrored for its side) at height y, plus the rim width."""
    best = 0.0
    n = len(outline)
    for i in range(n):
        x0, y0 = outline[i]
        x1, y1 = outline[(i + 1) % n]
        if (y0 - y) * (y1 - y) <= 0 and y0 != y1:
            t = (y - y0) / (y1 - y0)
            best = max(best, abs(x0 + (x1 - x0) * t))
    return best + rim_w


def bezier3(p0, p1, p2, p3, t):
    u = 1 - t
    return p0 * (u * u * u) + p1 * (3 * u * u * t) + p2 * (3 * u * t * t) + p3 * (t * t * t)


def arclens(path):
    out = [0.0]
    for i in range(1, len(path)):
        out.append(out[-1] + (path[i] - path[i - 1]).length)
    return out


def smooth_path(pts, subdiv):
    """Chaikin-style corner rounding of a polyline (keeps end points)."""
    cur = list(pts)
    for _ in range(subdiv):
        nxt = [cur[0]]
        for i in range(len(cur) - 1):
            a, bb = cur[i], cur[i + 1]
            nxt.append(a * 0.75 + bb * 0.25)
            nxt.append(a * 0.25 + bb * 0.75)
        nxt.append(cur[-1])
        cur = nxt
    return cur


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

def select_hierarchy(root):
    bpy.ops.object.select_all(action='DESELECT')
    def rec(o):
        o.select_set(True)
        for c in o.children:
            rec(c)
    rec(root)
    bpy.context.view_layer.objects.active = root


def export_glb(root, path):
    select_hierarchy(root)
    kwargs = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                  export_materials='EXPORT', export_animations=False, export_skins=False, export_morph=False,
                  export_cameras=False, export_lights=False, export_extras=False)
    try:
        bpy.ops.export_scene.gltf(**kwargs, export_texcoords=False, export_image_format='NONE')
    except TypeError:
        bpy.ops.export_scene.gltf(**kwargs)


def delete_hierarchy(root):
    objs = []
    def rec(o):
        objs.append(o)
        for c in o.children:
            rec(c)
    rec(root)
    for o in objs:
        me = o.data if o.type == 'MESH' else None
        bpy.data.objects.remove(o, do_unlink=True)
        if me is not None and me.users == 0:
            bpy.data.meshes.remove(me)


def build_all(defs, out_dir, only=None, keep=False):
    os.makedirs(out_dir, exist_ok=True)
    reports = []
    for d in defs:
        if only and d['frame_id'] not in only:
            continue
        root, rep = build_frame(d)
        path = os.path.join(out_dir, f"{d['frame_id']}.glb")
        export_glb(root, path)
        rep['glb'] = path
        rep['bytes'] = os.path.getsize(path)
        reports.append(rep)
        print('[frame_builder]', json.dumps(rep))
        if not keep:
            delete_hierarchy(root)
    with open(os.path.join(out_dir, 'build-report.json'), 'w') as f:
        json.dump(reports, f, indent=2)
    return reports


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    frames_path = 'scripts/frames.json'
    out_dir = 'public/assets/frames'
    only = None
    i = 0
    while i < len(argv):
        if argv[i] == '--frames':
            frames_path = argv[i + 1]; i += 2
        elif argv[i] == '--out':
            out_dir = argv[i + 1]; i += 2
        elif argv[i] == '--only':
            only = argv[i + 1].split(','); i += 2
        else:
            i += 1
    with open(frames_path) as f:
        defs = json.load(f)['frames']
    build_all(defs, out_dir, only)


if not globals().get('FRAME_BUILDER_NO_MAIN'):
    main()
