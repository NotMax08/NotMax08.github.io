# Robot models

Used by `playground.html`. Each folder holds a URDF and its meshes, decimated
from the originals to small GLB files (positions and indices only; normals are
rebuilt in the browser). The URDFs point at `meshes/<name>.glb`.

| Folder | Robot | Source | License |
| --- | --- | --- | --- |
| `bracketbot/` | BracketBot (`chopped_urdf_v2`) | BracketBot team | — |
| `yam/` | I2RT YAM arm | [i2rt-robotics/i2rt](https://github.com/i2rt-robotics/i2rt) `i2rt/robot_models/arm/yam/v1` | MIT, see `yam/LICENSE` |
| `piper/` | AgileX PiPER arm | [agilexrobotics/piper_ros](https://github.com/agilexrobotics/piper_ros) `src/piper_description` | MIT, see `piper/LICENSE` |
| `go2/` | Unitree Go2 | [unitreerobotics/unitree_ros](https://github.com/unitreerobotics/unitree_ros) `robots/go2_description` | BSD 3-Clause, see `go2/LICENSE` |
| `so101/` | SO-101 arm | [TheRobotStudio/SO-ARM100](https://github.com/TheRobotStudio/SO-ARM100) | Apache 2.0 |
