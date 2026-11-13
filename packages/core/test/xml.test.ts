import { describe, expect, it } from 'vitest';
import { encodePaintState } from '../src/paint.js';
import { rewriteModelXml, scanModelXml } from '../src/xml.js';

const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">
 <resources>
  <object id="1" type="model">
   <mesh>
    <vertices>
     <vertex x="1" y="2" z="3"/>
    </vertices>
    <triangles>
     <triangle v1="0" v2="1" v3="2" slic3rpe:mmu_segmentation="4" slic3rpe:custom_supports="1" slic3rpe:custom_seam="1"/>
     <triangle v1="0" v2="1" v3="2"/>
    </triangles>
   </mesh>
  </object>
 </resources>
 <build/>
</model>`;

describe('3MF model XML', () => {
  it('scans geometry and legacy paint attributes', () => {
    const scan = scanModelXml(model);
    expect(scan.unit).toBe('millimeter');
    expect(scan.vertices).toBe(1);
    expect(scan.triangles).toBe(2);
    expect([...scan.paintStates]).toEqual([1]);
    expect(scan.hasCustomSupports).toBe(true);
    expect(scan.hasCustomSeams).toBe(true);
    expect(scan.bounds).toEqual({ min: [1, 2, 3], max: [1, 2, 3] });
  });

  it('migrates legacy paint attributes and keeps self-closing tags', () => {
    const output = rewriteModelXml(model, {
      paintMap: new Map([[1, 3]]),
      setUnit: 'millimeter',
    });
    expect(output).toContain(`paint_color="${encodePaintState(3)}"`);
    expect(output).toContain('paint_supports="1"');
    expect(output).toContain('paint_seam="1"');
    expect(output).not.toContain('slic3rpe:mmu_segmentation');
    expect(output).not.toContain('slic3rpe:custom_supports');
    expect(output).not.toContain('slic3rpe:custom_seam');
    expect(output).toContain('<vertex x="1" y="2" z="3"/>');
    expect(output).not.toContain('></vertex>');
  });

  it('scales vertex coordinates without rebuilding unchanged tags', () => {
    const output = rewriteModelXml(model, { scale: 2 });
    expect(output).toContain('<vertex x="2" y="4" z="6"/>');
  });

  it('rejects DTDs and malformed element nesting', () => {
    expect(() => scanModelXml('<!DOCTYPE model [<!ENTITY x "y">]><model/>')).toThrow(/DTD/);
    expect(() => scanModelXml('<model><resources></model>')).toThrow(/unexpected closing tag/);
    expect(() => scanModelXml('<model><resources>')).toThrow(/unclosed elements/);
  });
});
