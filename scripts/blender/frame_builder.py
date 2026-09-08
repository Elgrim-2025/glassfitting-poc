"""Parametric eyeglass-frame modelling in Blender → GLB (docs/assets/glb-spec.md).

Reads scripts/frames.json and builds each frame from its spec (mm): flat-profile rims
swept around the lens outline (width tapering from the top rim to the bottom rim), curved
lenses, a bridge bar, end pieces with hinges and optional metal rivets, tapered temples
that bend behind the ear with an optional translucent tip, and nose pads. Node names
follow the asset spec so the runtime rig (src/platform/render/glasses.ts) and the clearance
solver can use them.

Coordinates: glTF axes are +Y up, +Z toward the camera, origin at the nose-pad contact
plane. Blender is Z-up, so a glTF point (x, y, z) is modelled at Blender (x, -z, y); the
default "+Y up" export maps it back.

The lens outline functions mirror scripts/lib/lens-outline.mjs (the JS side derives the
mock API's rim outline from the same definitions; gen-frames.mjs cross-checks both).

Usage (headless):
  Blender -b --python scripts/blender/frame_builder.py -- --frames scripts/frames.json --out public/assets/frames [--only FR-0001] [--report path.json]
Usage (Blender MCP / interactive): set FRAME_BUILDER_NO_MAIN = True before exec'ing this
file, then call build_all(defs, out_dir) or build_frame(def).
"""
import bpy
import bmesh
import json
import math
import os
import sys
from mathutils import Matrix, Vector

LENS_SPHERE_R = 130.0        # 4-base lens curve
LENS_CENTER_THICKNESS = 1.5  # assumed centre thickness for the lens back (vertex distance)

# ---------------------------------------------------------------------------
# Coordinates and 2-D outlines (port of scripts/lib/lens-outline.mjs)
# ---------------------------------------------------------------------------

def G(x, y, z):
    """glTF (x, y, z) → Blender vector."""
    return Vector((x, -z, y))


def dedupe(pts, eps=1e-6):
    out = []
    for p in pts:
        if not out or (abs(p[0] - out[-1][0]) > eps or abs(p[1] - out[-1][1]) > eps):
            out.append((p[0], p[1]))
    if len(out) > 1 and abs(out[0][0] - out[-1][0]) < eps and abs(out[0][1] - out[-1][1]) < eps:
        out.pop()
    return out


def signed_area(pts):
    a = 0.0
    for i in range(len(pts)):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % len(pts)]
        a += x0 * y1 - x1 * y0
    return a / 2


def fillet_polygon(corners, radii, n_corner=8):
    """Replaces each corner of a convex polygon by an arc tangent to both adjacent edges."""
    n = len(corners)
    pts = []
    for i in range(n):
        P = Vector(corners[i])
        A = Vector(corners[(i - 1) % n])
        B = Vector(corners[(i + 1) % n])
        u = (A - P)
        v = (B - P)
        la, lb = u.length, v.length
        u.normalize()
        v.normalize()
        r = radii[i]
        if r <= 1e-6:
            pts.append((P.x, P.y))
            continue
        theta = math.acos(max(-1.0, min(1.0, u.dot(v))))
        d = min(r / math.tan(theta / 2), la * 0.5, lb * 0.5)
        r_eff = d * math.tan(theta / 2)
        T1 = P + u * d
        T2 = P + v * d
        bis = (u + v).normalized()
        C = P + bis * (r_eff / math.sin(theta / 2))
        a1 = math.atan2(T1.y - C.y, T1.x - C.x)
        da = math.atan2(T2.y - C.y, T2.x - C.x) - a1
        while da > math.pi:
            da -= 2 * math.pi
        while da < -math.pi:
            da += 2 * math.pi
        for k in range(n_corner + 1):
            a = a1 + da * k / n_corner
            pts.append((C.x + r_eff * math.cos(a), C.y + r_eff * math.sin(a)))
    return dedupe(pts)


def normalize_box(pts, w, h):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    sx = w / (max(xs) - min(xs))
    sy = h / (max(ys) - min(ys))
    cx = (min(xs) + max(xs)) / 2
    cy = (min(ys) + max(ys)) / 2
    return [((x - cx) * sx, (y - cy) * sy) for (x, y) in pts]


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
    hw, hh = w / 2, h / 2
    pts = []
    pts += bezier((-hw, hh * 0.55), (-hw, hh), (-hw * 0.3, hh), (0, hh), n)
    pts += bezier((0, hh), (hw * 0.6, hh), (hw, hh * 0.7), (hw, hh * 0.2), n)
    pts += bezier((hw, hh * 0.2), (hw, -hh * 0.5), (hw * 0.55, -hh), (0, -hh), n)
    pts += bezier((0, -hh), (-hw * 0.7, -hh), (-hw, -hh * 0.4), (-hw, hh * 0.55), n)
    pts = dedupe(pts)
    pts = pts if signed_area(pts) > 0 else list(reversed(pts))
    return normalize_box(pts, w, h)


def lens_outline(shape, w, h, b=None):
    """+X lens outline in its own centred coordinates (mm), CCW, boxed exactly to w × h."""
    b = b or {}
    hw, hh = w / 2, h / 2
    if shape == 'round':
        return ellipse(w, h, 96)
    if shape == 'aviator':
        return aviator(w, h)
    if shape == 'wellington':
        r_to, r_ti, r_bi, r_bo = b.get('corner_radius_mm', [4, 6, 11, 9])
        s_in, s_out = b.get('inner_slant_mm', 3.5), b.get('outer_slant_mm', 1.5)
        corners = [(hw, hh), (-hw, hh), (-hw + s_in, -hh), (hw - s_out, -hh)]
        return normalize_box(fillet_polygon(corners, [r_to, r_ti, r_bi, r_bo], 8), w, h)
    r, rb = min(9, w * 0.17), min(12, w * 0.22)
    return normalize_box(fillet_polygon([(hw, hh), (-hw, hh), (-hw, -hh), (hw, -hh)], [r, r, rb, rb], 6), w, h)


def resample_closed(pts, spacing=None, count=None):
    """Evenly spaced points along a closed polyline (by spacing in mm, or a fixed count)."""
    n = len(pts)
    seg = []
    total = 0.0
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        d = math.hypot(x1 - x0, y1 - y0)
        seg.append(d)
        total += d
    count = count or max(12, int(round(total / spacing)))
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
    """Offset a closed CCW polyline outward by dist (number or callable (x, y) → mm), bisector method."""
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
        d = dist(x1, y1) if callable(dist) else dist
        out.append((x1 + bis.x * d / cos_half, y1 + bis.y * d / cos_half))
    return out


def rim_width_at(y, hh, top, bottom):
    return bottom + (top - bottom) * ((y + hh) / (2 * hh))


# ---------------------------------------------------------------------------
# Profiles and sweeps
# ---------------------------------------------------------------------------

def profile_rect(w, h, r, seg=4):
    """Rounded rectangle in the (u, v) profile plane, CCW."""
    r = min(r, w / 2 - 1e-3, h / 2 - 1e-3)
    hw, hh = w / 2, h / 2
    return fillet_polygon([(hw, hh), (-hw, hh), (-hw, -hh), (hw, -hh)], [r, r, r, r], seg)


def profile_circle(d, n=14):
    return [(d / 2 * math.cos(2 * math.pi * k / n), d / 2 * math.sin(2 * math.pi * k / n)) for k in range(n)]


def sweep(bm, path, profile, up, closed=False, taper=None, outward=None, material=0):
    """Sweep a 2-D profile along a 3-D path (Blender coords).

    Frame at each point: t = tangent, n = normalize(t × up) (profile u axis), b = n × t (v).
    `outward`, when given (Blender vector, the outline centre), flips n to point away from it.
    `taper(i, s)` returns (su, sv) profile scale at path index i / arc length s.
    `material` is an int or a callable (i, s) → material index for the faces after ring i.
    Returns (faces, arclengths).
    """
    N = len(path)
    rings = []
    arcs = []
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
        arcs.append(s)
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
        mi = material(i, arcs[i]) if callable(material) else material
        for k in range(M):
            f = bm.faces.new((r0[k], r0[(k + 1) % M], r1[(k + 1) % M], r1[k]))
            f.material_index = mi
            faces.append(f)
    if not closed:
        f0 = bm.faces.new(rings[0])
        f0.material_index = material(0, 0.0) if callable(material) else material
        f1 = bm.faces.new(list(reversed(rings[-1])))
        f1.material_index = material(N - 2, arcs[-1]) if callable(material) else material
        faces += [f0, f1]
    return faces, arcs


def ellipsoid(bm, center, radii, rot=None, segments=20, rings=12, material=0):
    """UV ellipsoid (Blender-axis radii); rot is a 3×3 Matrix applied before translation."""
    res = bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)
    verts = res['verts']
    for v in verts:
        p = Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2]))
        if rot is not None:
            p = rot @ p
        v.co = p + center
    if material:
        for f in bm.faces:
            if all(v in verts for v in f.verts):
                f.material_index = material
    return verts


def cylinder(bm, center, axis, radius, length, segments=12, material=0):
    """Closed cylinder around `axis` (Blender unit vector) centred at `center`."""
    axis = axis.normalized()
    ref = Vector((0, 0, 1)) if abs(axis.z) < 0.9 else Vector((1, 0, 0))
    u = axis.cross(ref).normalized()
    v = axis.cross(u).normalized()
    ring0, ring1 = [], []
    for k in range(segments):
        a = 2 * math.pi * k / segments
        d = u * (radius * math.cos(a)) + v * (radius * math.sin(a))
        ring0.append(bm.verts.new(center - axis * (length / 2) + d))
        ring1.append(bm.verts.new(center + axis * (length / 2) + d))
    faces = []
    for k in range(segments):
        faces.append(bm.faces.new((ring0[k], ring0[(k + 1) % segments], ring1[(k + 1) % segments], ring1[k])))
    faces.append(bm.faces.new(ring0))
    faces.append(bm.faces.new(list(reversed(ring1))))
    for f in faces:
        f.material_index = material
    return faces


SHARP_ANGLE = math.radians(20)


def finish_mesh(name, bm, materials, smooth=True):
    """Smooth-shaded mesh whose edges sharper than SHARP_ANGLE keep a crease (split normals on
    export), so flat acetate faces read as flat instead of the tube look of fully smooth normals."""
    if not isinstance(materials, (list, tuple)):
        materials = [materials]
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for e in bm.edges:
        if len(e.link_faces) == 2:
            try:
                if e.calc_face_angle() > SHARP_ANGLE:
                    e.smooth = False
            except ValueError:
                pass
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = smooth
    for m in materials:
        me.materials.append(m)
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
    rim_w_bot = b.get('rim_width_bottom_mm', rim_w)
    lens_cy = b['lens_center_y_mm']
    lens_cx = bw / 2 + lw / 2
    hh = lh / 2
    bridge_y = lens_cy + lh * b['bridge_height_ratio']
    hinge_y, hinge_z = b['hinge_y_mm'], b['hinge_z_mm']
    hinge_x = fw / 2 - b.get('hinge_inset_mm', 0)
    end_mm = b['endpiece_mm']
    bend, drop, hook = b.get('temple_bend_mm', round(tl * 0.68)), b.get('temple_drop_mm', 28), b.get('temple_hook_mm', 2)
    tip_len = b.get('temple_tip_mm', 0)
    sec, tip = b['temple_section_mm'], b['temple_tip_section_mm']
    pad_c, pad_s = b['pad_center'], b['pad_size_mm']
    pad_tilt = math.radians(b.get('pad_tilt_deg', 0))
    pad_splay = math.radians(b.get('pad_splay_deg', 25))
    rivets = bool(b.get('rivets', False))
    width_at = lambda y: rim_width_at(y, hh, rim_w, rim_w_bot)  # y in lens-local coords

    frame_mat = make_material(f"{d['frame_id']}_frame", d['color'], d['metallic'], d['roughness'])
    lens_mat = make_material(f"{d['frame_id']}_lens", d['lens_tint'], 0.0, 0.05, d['lens_alpha'])
    pad_mat = make_material(f"{d['frame_id']}_pad", (0.92, 0.92, 0.92), 0.0, 0.5, 0.6)
    metal_mat = make_material(f"{d['frame_id']}_metal", (0.86, 0.86, 0.88), 0.95, 0.25)
    tip_mat = make_material(f"{d['frame_id']}_tip", (0.72, 0.72, 0.74), 0.0, 0.2, 0.45)

    root = empty(d['frame_id'], Vector((0, 0, 0)))
    rim_profile = profile_rect(rim_w, rim_d, rim_r)
    rim_z = lens_z - rim_d / 2 + 1.0  # rim front 1 mm proud of the lens plane
    rim_back = rim_z - rim_d / 2
    front_bm = bmesh.new()
    lenses = []
    rim_outer = None
    outline_r = None

    for side in (-1, 1):
        outline = lens_outline(d['shape'], lw, lh, b)
        if side > 0:
            outline_r = outline
        outline = [(side * x, y) for (x, y) in outline]
        if side < 0:
            outline = list(reversed(outline))  # keep CCW after mirroring
        centre_pts = resample_closed(offset_closed(outline, lambda x, y: width_at(y) / 2), spacing=1.2)
        path = [G(side * lens_cx + x, lens_cy + y, rim_z) for (x, y) in centre_pts]
        ys = [y for (_, y) in centre_pts]
        taper = (lambda i, s, ys=ys: (width_at(ys[i]) / rim_w, 1.0))
        sweep(front_bm, path, rim_profile, up=G(0, 0, 1), closed=True, taper=taper, outward=G(side * lens_cx, lens_cy, rim_z))
        if side > 0:
            outer = offset_closed(outline, lambda x, y: width_at(y))
            rim_outer = [(round(lens_cx + x, 2), round(lens_cy + y, 2)) for (x, y) in resample_closed(outer, count=48)]

        # Lens: filled outline, spherical sag (4-base ≈ R 130 mm), 0.8 mm behind the rim front.
        lb = bmesh.new()
        inner = resample_closed(outline, spacing=2.0)
        verts = [lb.verts.new(G(side * lens_cx + x, lens_cy + y, lens_z)) for (x, y) in inner]
        lb.faces.new(verts)
        bmesh.ops.triangulate(lb, faces=lb.faces[:])
        for _ in range(3):
            bmesh.ops.subdivide_edges(lb, edges=lb.edges[:], cuts=1, use_grid_fill=True)
        bmesh.ops.triangulate(lb, faces=lb.faces[:])
        R = LENS_SPHERE_R
        cx, cy = side * lens_cx, lens_cy
        edge_sag = R - math.sqrt(max(0.0, R * R - (lw / 2) ** 2))
        for v in lb.verts:
            gx, gy = v.co.x, v.co.z
            r2 = (gx - cx) ** 2 + (gy - cy) ** 2
            sag = R - math.sqrt(max(0.0, R * R - r2))
            v.co.y = -(lens_z - 0.8 + (edge_sag - sag))
        lenses.append(finish_mesh('lens_L' if side < 0 else 'lens_R', lb, lens_mat))

        # End piece: a rounded block that thickens the rim's outer side and carries the hinge.
        x_out = side * fw / 2
        z_front = rim_z + rim_d / 2
        rim_edge_x = side * (lens_cx + rim_edge_at(outline, hinge_y - lens_cy, width_at(hinge_y - lens_cy)))
        if not metal:
            depth = end_mm + 2
            ep = profile_rect(depth, end_mm, min(1.5, end_mm * 0.25))
            x_in = rim_edge_x - side * 3
            box = [G(x_in, hinge_y, z_front - depth / 2), G(x_out, hinge_y, z_front - depth / 2)]
            sweep(front_bm, box, ep, up=G(0, 1, 0))
            if rivets:
                for dx in (2.6, 5.6):
                    cylinder(front_bm, G(x_out - side * dx, hinge_y, z_front - 0.2), G(0, 0, 1), 0.7, 1.0, 12, material=1)
        else:
            block_w = end_mm * 0.8
            strut = [G(rim_edge_x - side * 1.0, hinge_y, rim_z), G(x_out - side * block_w * 0.5, hinge_y, rim_z)]
            sweep(front_bm, strut, profile_circle(1.8), up=G(0, 1, 0))
            depth = end_mm * 0.7
            ep = profile_rect(depth, end_mm * 0.9, 0.8)
            box = [G(x_out - side * block_w, hinge_y, z_front - depth / 2), G(x_out, hinge_y, z_front - depth / 2)]
            sweep(front_bm, box, ep, up=G(0, 1, 0))
            ellipsoid(front_bm, G(side * hinge_x, hinge_y, hinge_z - 1.0), (1.2, 3.0, 1.2), segments=14, rings=8)

    # Bridge: bar between the rims at bridge_y, embedded into both rims.
    inner_left = -(bw / 2) - width_at(bridge_y - lens_cy)
    arch = [G(inner_left * (1 - t) + (-inner_left) * t, bridge_y + b['bridge_arch_mm'] * math.sin(math.pi * t), rim_z) for t in [k / 24 for k in range(25)]]
    bridge_profile = profile_rect(b.get('bridge_bar_mm', rim_w), rim_d, rim_r) if not metal else profile_circle(1.8)
    sweep(front_bm, arch, bridge_profile, up=G(0, 0, 1))
    if b.get('double_bridge_mm'):
        y2 = bridge_y + b['double_bridge_mm']
        bar = [G(inner_left * 1.15 * (1 - t) + (-inner_left) * 1.15 * t, y2 + 1.0 * math.sin(math.pi * t), rim_z) for t in [k / 16 for k in range(17)]]
        sweep(front_bm, bar, profile_circle(1.6), up=G(0, 0, 1))
    front = finish_mesh('frame_front', front_bm, [frame_mat, metal_mat])

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
        tip_start = length - tip_len if tip_len > 0 else float('inf')
        mat_of = lambda i, s, ts=tip_start: 1 if s >= ts else 0
        if metal:
            wire_end = length - 40
            wpath = [p for p, s in zip(path, arclens(path)) if s <= wire_end + 2]
            sweep(tb, wpath, profile_circle(sec[0]), up=G(0, 1, 0))
            tpath = [p for p, s in zip(path, arclens(path)) if s >= wire_end - 2]
            sweep(tb, tpath, profile_rect(tip[1], tip[0], 0.8), up=G(0, 1, 0), material=1)
        else:
            def taper(i, s, L=length):
                t = min(1.0, max(0.0, s / L))
                return ((sec[1] + (tip[1] - sec[1]) * t) / sec[1], (sec[0] + (tip[0] - sec[0]) * t) / sec[0])
            sweep(tb, path, profile_rect(sec[1], sec[0], 0.8), up=G(0, 1, 0), taper=taper, material=mat_of)
            if rivets:
                for dz in (6.0, 9.0):
                    cylinder(tb, G(x0 + side * (sec[1] / 2 - 0.2), hinge_y, z0 - dz), G(1, 0, 0), 0.7, 1.0, 12, material=2)
        temples.append(finish_mesh('temple_L' if side < 0 else 'temple_R', tb, [frame_mat, tip_mat, metal_mat]))

    # Nose pads (pad_size_mm = [width x, height y, thickness z]); the contact face is at pad z − thickness/2.
    pb = bmesh.new()
    for side in (-1, 1):
        c = G(side * pad_c[0], pad_c[1], pad_c[2])
        if metal:
            m = Matrix.Rotation(-side * pad_tilt, 3, 'Z') @ Matrix.Rotation(math.radians(8) * side, 3, 'Y')
            ellipsoid(pb, c, (pad_s[0] / 2, pad_s[2] / 2, pad_s[1] / 2), rot=m, segments=16, rings=10)
            inner_x = side * (lens_cx - rim_edge_at(outline_r_mirror(outline_r, side), pad_c[1] + 2 - lens_cy, width_at(pad_c[1] + 2 - lens_cy) * 0.5))
            arm_from = G(inner_x, pad_c[1] + 2, rim_z)
            arm_to = c + G(side * 0.8, 1.0, 0.6) - G(0, 0, 0)
            arm = smooth_path([arm_from, G(inner_x - side * 1.5, pad_c[1] + 2.5, rim_z - 2.5), arm_to], 4)
            sweep(pb, arm, profile_circle(1.0), up=G(0, 0, 1))
        else:
            # Fixed pad: a bump whose inner face is splayed toward the nose flank (rotation about the vertical axis).
            m = Matrix.Rotation(side * pad_splay, 3, 'Z')
            ellipsoid(pb, c, (pad_s[0] / 2, pad_s[2] / 2, pad_s[1] / 2), rot=m, segments=16, rings=10)
    pads = finish_mesh('nose_pads', pb, pad_mat)

    anchors = [
        empty('anchor_bridge', Vector((0, 0, 0))),
        empty('anchor_temple_L', G(-hinge_x, hinge_y, hinge_z)),
        empty('anchor_temple_R', G(hinge_x, hinge_y, hinge_z)),
    ]
    for ob in [front, pads] + lenses + temples + anchors:
        ob.parent = root

    edge_sag = LENS_SPHERE_R - math.sqrt(LENS_SPHERE_R ** 2 - (lw / 2) ** 2)
    report = {
        'frame_id': d['frame_id'],
        'front_width_mm': front.dimensions.x,
        'lens_width_mm': lenses[0].dimensions.x,
        'lens_height_mm': lenses[0].dimensions.z,
        'triangles': sum(len(o.data.polygons) for o in [front, pads] + lenses + temples),
        'hinge': [hinge_x, hinge_y, hinge_z],
        'rim_back_mm': round(rim_back, 2),
        'lens_back_mm': round(lens_z - 0.8 + edge_sag - LENS_CENTER_THICKNESS, 2),
        'pad_contact': [pad_c[0], pad_c[1], round(pad_c[2] - pad_s[2] / 2, 2)],
        'rim_outline_mm': rim_outer,
    }
    return root, report


def outline_r_mirror(outline_r, side):
    pts = [(side * x, y) for (x, y) in outline_r]
    return list(reversed(pts)) if side < 0 else pts


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


def build_all(defs, out_dir, only=None, keep=False, report_path=None):
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
        print('[frame_builder]', json.dumps({k: v for k, v in rep.items() if k != 'rim_outline_mm'}))
        if not keep:
            delete_hierarchy(root)
    if report_path:
        with open(report_path, 'w') as f:
            json.dump(reports, f, indent=1)
    return reports


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    frames_path = 'scripts/frames.json'
    out_dir = 'public/assets/frames'
    only, report = None, None
    i = 0
    while i < len(argv):
        if argv[i] == '--frames':
            frames_path = argv[i + 1]; i += 2
        elif argv[i] == '--out':
            out_dir = argv[i + 1]; i += 2
        elif argv[i] == '--only':
            only = argv[i + 1].split(','); i += 2
        elif argv[i] == '--report':
            report = argv[i + 1]; i += 2
        else:
            i += 1
    with open(frames_path) as f:
        defs = json.load(f)['frames']
    build_all(defs, out_dir, only, report_path=report)


if not globals().get('FRAME_BUILDER_NO_MAIN'):
    main()
