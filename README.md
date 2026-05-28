# Sky Crystal Escape

An interactive WebGL final project game for Computer Graphics.

## Run

From this folder:

```sh
python3 -m http.server 8017
```

Open:

```text
http://127.0.0.1:8017/
```

## Controls

- WASD: move the player
- Space: jump over low gates and laser beams
- Mouse drag: rotate the player/camera direction
- V: switch between third-person and first-person camera
- Enter: start from the title screen
- R: restart after win or game over

## Goal

Run through the extended laser corridor, collect all eleven sky crystals, then enter the reflective portal before time runs out.

## Lose Condition

You lose if HP reaches 0 or the timer reaches 0. Red hazard blocks, moving laser beams, and red floor tiles reduce HP.

## Graphics Requirements Covered

- Player is a loaded and texture-mapped `.obj` model: `sonic.obj`
- Other 3D `.obj` objects: `sphere.obj`, `cube.obj`
- Point light with Phong local illumination
- Texture-mapped Sonic player and floating platform
- Environment cube map skybox
- Cube map reflection on the portal
- Shadow mapping
- Dynamic reflection rendered into a cube-map framebuffer
- Start screen and end result screen
- Extended corridor map with low gates that must be jumped
- Moving laser obstacles that require timing and jumping
- Warning floor tiles that turn orange before becoming dangerous red tiles

## Design Document Notes

- The procedural skybox avoids real-world scenery so the whole screen reads as a pure game corridor.
- The reflective portal is placed at the far side of the platform so the player must explore before winning.
- Crystals use high specular and shininess values so they read visually as collectible magical objects.
- Hazard blocks use strong red color for immediate gameplay readability.
- The point light is above and to the side, producing visible shadows that help demonstrate depth and obstacle placement.
