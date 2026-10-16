# OBJ material imports

Select an OBJ and its companion MTL libraries together. File order does not matter. Referenced libraries match relative paths or unique basenames, case-insensitively; quoted filenames and filenames containing spaces are supported. Ambiguous names fail explicitly. Missing libraries retain material groups with placeholder colors and a warning.

The importer preserves each face's `usemtl` assignment and reads diffuse RGB `Kd` colors, including white. Vertex colors are multiplied by the material color. Interpolated vertex colors become six nearest-vertex patches per triangle so each patch can use a physical filament. Source triangles remain separate from colored surface tessellation, retaining the original closed mesh for material processing.

OBJ exporters sometimes split one shell across `g` or `o` groups. Parts sharing unmatched edges are reunited before color processing; already closed solids remain separate linked parts. This is not general mesh repair. Closed, consistently oriented geometry is required for material-region conversion. Relative placement is retained, with the complete import centered and grounded together. The largest surface-area material supplies the interior; other colors use the adjustable paint depth. Existing filament matching and project history/recovery apply normally.

Limits: 64 material colors, 64 libraries, 10 MB per library, 200 resulting parts, and the application's existing geometry limits. Texture images, transparency and other optical MTL properties are not physical filament definitions. Diffuse textures are not fetched or converted; texture and transparency use produces explicit warnings. Further vendor metadata and texture fidelity remain outside this implementation.

Implementation uses the installed Three.js OBJ loader and an independent diffuse-color MTL reader. References: [OBJLoader](https://threejs.org/docs/pages/OBJLoader.html), [MTLLoader](https://threejs.org/docs/pages/MTLLoader.html), and [OBJ loading guide](https://threejs.org/manual/pages/load-obj.html).

Regression coverage checks split surface groups, separate closed solids, white colors, missing/ambiguous libraries, palette limits, vertex-color volume conservation, project persistence, and desktop/phone import through actual colored G-code export.
