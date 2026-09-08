"""Renders a frame GLB alone (front, 3/4, side, top) with Workbench for a quick visual check.

Usage (headless):
  Blender -b --python scripts/blender/render_frame.py -- --glb public/assets/frames/FR-0001.glb --out bench/renders/frame
Writes <out>_front.png, <out>_34.png, <out>_side.png, <out>_top.png (800 × 600).
"""
import bpy
import math
import os
import sys
from mathutils import Euler, Vector


def setup(scene):
    if 'FrameCam' not in bpy.data.objects:
        cam = bpy.data.objects.new('FrameCam', bpy.data.cameras.new('FrameCam'))
        scene.collection.objects.link(cam)
    cam = bpy.data.objects['FrameCam']
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.lens_unit = 'FOV'
    cam.data.angle = math.radians(30)
    cam.data.clip_start = 5
    cam.data.clip_end = 5000
    scene.camera = cam
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_shadows = False
    scene.display.shading.show_specular_highlight = True
    scene.render.resolution_x = 800
    scene.render.resolution_y = 600
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.film_transparent = False
    world = scene.world or bpy.data.worlds.new('World')
    scene.world = world
    world.color = (0.9, 0.9, 0.9)
    return cam


def shoot(scene, cam, path, yaw_deg, pitch_deg=0, dist=420, target=(0, 0, 0)):
    a = math.radians(yaw_deg)
    p = math.radians(pitch_deg)
    t = Vector(target)
    cam.location = t + Vector((-dist * math.sin(a) * math.cos(p), -dist * math.cos(a) * math.cos(p), dist * math.sin(p)))
    cam.rotation_euler = Euler((math.radians(90) - p, 0, -a))
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    glb, out = 'public/assets/frames/FR-0001.glb', 'bench/renders/frame'
    i = 0
    while i < len(argv):
        if argv[i] == '--glb':
            glb = argv[i + 1]; i += 2
        elif argv[i] == '--out':
            out = argv[i + 1]; i += 2
        else:
            i += 1
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=glb)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    scene = bpy.context.scene
    cam = setup(scene)
    # glTF (0, 5, -60) = frame centre-ish → Blender (0, 60, 5)
    target = (0, 30, 0)
    shoot(scene, cam, out + '_front.png', 0, 0, 360, (0, 0, 0))
    shoot(scene, cam, out + '_34.png', 35, 8, 420, target)
    shoot(scene, cam, out + '_side.png', 90, 0, 420, target)
    shoot(scene, cam, out + '_top.png', 0, 89, 420, target)
    print('[render_frame] wrote', out + '_{front,34,side,top}.png')


if not globals().get('RENDER_FRAME_NO_MAIN'):
    main()
