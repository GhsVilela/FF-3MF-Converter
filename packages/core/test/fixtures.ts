import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeZip } from '../src/zip.js';

export interface FixtureOptions {
  withSettings?: boolean;
  withModelSettings?: boolean;
  paintStates?: string[];
  sliced?: boolean;
}

const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="gcode" ContentType="text/x.gcode"/>
</Types>`;

const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

const modelRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/Objects/part.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

function rootModel() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <metadata name="Application">BambuStudio-2.3.0</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Title">Fixture</metadata>
 <resources>
  <object id="2" p:UUID="00000002-0000-4000-8000-000000000002" type="model">
   <components>
    <component p:path="/3D/Objects/part.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 10 10 10"/>
   </components>
  </object>
 </resources>
 <build p:UUID="00000003-0000-4000-8000-000000000003">
  <item objectid="2" transform="1 0 0 0 1 0 0 0 1 90 90 0" printable="1"/>
 </build>
</model>`;
}

function partModel(paintStates: string[]) {
  const faces = [
    '0 1 2',
    '0 3 1',
    '4 5 6',
    '4 6 7',
    '0 2 5',
    '0 5 4',
    '2 1 6',
    '2 6 5',
    '1 3 7',
    '1 7 6',
    '3 0 4',
    '3 4 7',
  ];
  const vertices = [
    [-10, -10, -10],
    [10, 10, -10],
    [10, -10, -10],
    [-10, 10, -10],
    [-10, -10, 10],
    [10, -10, 10],
    [10, 10, 10],
    [-10, 10, 10],
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
 <resources>
  <object id="1" p:UUID="00000001-0000-4000-8000-000000000001" type="model">
   <mesh>
    <vertices>
${vertices.map(([x, y, z]) => `     <vertex x="${x}" y="${y}" z="${z}"/>`).join('\n')}
    </vertices>
    <triangles>
${faces
  .map((face, index) => {
    const [a, b, c] = face.split(' ');
    const paint = paintStates[index % Math.max(1, paintStates.length)];
    return `     <triangle v1="${a}" v2="${b}" v3="${c}"${paint ? ` paint_color="${paint}"` : ''}/>`;
  })
  .join('\n')}
    </triangles>
   </mesh>
  </object>
 </resources>
 <build/>
</model>`;
}

function projectSettings() {
  return JSON.stringify(
    {
      printer_model: 'Bambu Lab X1 Carbon',
      printer_variant: '0.4',
      printer_settings_id: 'Bambu Lab X1 Carbon 0.4 nozzle',
      print_settings_id: '0.16mm Optimal @BBL X1C',
      layer_height: '0.16',
      wall_loops: '4',
      sparse_infill_density: '25%',
      enable_support: '1',
      support_threshold_angle: '40',
      top_shell_layers: '5',
      filament_colour: ['#FF0000', '#00FF00', '#0000FF', '#FFFFFF'],
      filament_type: ['PLA', 'PLA', 'PLA', 'PLA'],
      filament_settings_id: [
        'Bambu PLA Basic',
        'Bambu PLA Basic',
        'Bambu PLA Basic',
        'Bambu PLA Basic',
      ],
      nozzle_temperature: ['220', '220', '220', '220'],
      nozzle_temperature_initial_layer: ['220', '220', '220', '220'],
      hot_plate_temp: ['60', '60', '60', '60'],
      hot_plate_temp_initial_layer: ['60', '60', '60', '60'],
      different_settings_to_system: [
        'enable_support;layer_height;sparse_infill_density;support_threshold_angle;top_shell_layers;wall_loops',
        'nozzle_temperature',
        'nozzle_temperature',
        'nozzle_temperature',
        'nozzle_temperature',
        '',
      ],
    },
    null,
    2,
  );
}

function modelSettings() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<config>
 <object id="2">
  <metadata key="name" value="Fixture part"/>
  <metadata key="extruder" value="1"/>
  <part id="1" subtype="normal_part">
   <metadata key="name" value="Fixture part"/>
  </part>
 </object>
 <plate>
  <metadata key="plater_id" value="1"/>
  <metadata key="plater_name" value=""/>
  <model_instance>
   <metadata key="object_id" value="2"/>
   <metadata key="instance_id" value="0"/>
   <metadata key="identify_id" value="14"/>
  </model_instance>
 </plate>
</config>`;
}

export async function createFixtureAsync(options: FixtureOptions = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'open3mf-test-'));
  const file = path.join(directory, 'source.3mf');
  const entries = [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: '3D/3dmodel.model', data: rootModel() },
    { name: '3D/_rels/3dmodel.model.rels', data: modelRels },
    { name: '3D/Objects/part.model', data: partModel(options.paintStates ?? []) },
  ];
  if (options.withModelSettings !== false) {
    entries.push({ name: 'Metadata/model_settings.config', data: modelSettings() });
  }
  if (options.withSettings !== false) {
    entries.push({ name: 'Metadata/project_settings.config', data: projectSettings() });
  }
  if (options.sliced) {
    entries.push({ name: 'Metadata/plate_1.gcode', data: '; sliced\nG28\n' });
  }
  await writeZip(file, entries);
  return {
    directory,
    file,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
