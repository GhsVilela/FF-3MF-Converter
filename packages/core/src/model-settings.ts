function remapValue(value: string, paintMap: Map<number, number>): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return value;
  return String(paintMap.get(parsed) ?? 1);
}

export function patchModelSettingsXml(
  xml: string | undefined,
  paintMap: Map<number, number>,
  plateCount: number,
): string {
  if (!xml) {
    const plates = Array.from({ length: Math.max(1, plateCount) }, (_, index) => {
      return [
        '  <plate>',
        `    <metadata key="plater_id" value="${index + 1}"/>`,
        '    <metadata key="plater_name" value=""/>',
        '  </plate>',
      ].join('\n');
    });
    return ['<?xml version="1.0" encoding="UTF-8"?>', '<config>', ...plates, '</config>', ''].join(
      '\n',
    );
  }

  let patched = xml.replace(
    /(<metadata\s+key="(extruder|support_filament|support_interface_filament)"\s+value=")(\d+)(")/g,
    (_match, prefix: string, _key: string, value: string, suffix: string) =>
      `${prefix}${remapValue(value, paintMap)}${suffix}`,
  );
  if (!/<plate\b/.test(patched)) {
    const plates = Array.from({ length: Math.max(1, plateCount) }, (_, index) => {
      return [
        '  <plate>',
        `    <metadata key="plater_id" value="${index + 1}"/>`,
        '    <metadata key="plater_name" value=""/>',
        '  </plate>',
      ].join('\n');
    });
    patched = patched.replace('</config>', `${plates.join('\n')}\n</config>`);
  }
  return patched;
}
