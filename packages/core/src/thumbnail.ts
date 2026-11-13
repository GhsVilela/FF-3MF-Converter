import type { ZipContents } from './zip.js';

export interface ProjectThumbnail {
  data: Buffer;
  mime: 'image/png' | 'image/jpeg';
  name: string;
}

const MAX_THUMBNAIL_BYTES = 4 * 1024 * 1024;

const CANDIDATES = [
  'Metadata/plate_1.png',
  'Metadata/plate_1.jpg',
  'Metadata/plate_1.jpeg',
  'Metadata/plate_1_small.png',
  'Metadata/plate_1_small.jpg',
  'Metadata/thumbnail.png',
  'Metadata/thumbnail.jpg',
  'Auxiliaries/.thumbnails/thumbnail_3mf.png',
  'Auxiliaries/.thumbnails/thumbnail_middle.png',
  'Auxiliaries/.thumbnails/thumbnail_small.png',
  'Metadata/plate_no_light_1.png',
  'Metadata/top_1.png',
];

function imageMime(data: Buffer): ProjectThumbnail['mime'] | undefined {
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return 'image/png';
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  return undefined;
}

/**
 * Return the best available plate/project preview from a 3MF package. The
 * image itself is not part of the shared analysis payload; the API stores it
 * next to the upload and serves it through a dedicated endpoint.
 */
export function findProjectThumbnail(contents: ZipContents): ProjectThumbnail | undefined {
  const names = new Set(contents.names);
  const ordered = [
    ...CANDIDATES.filter((name) => names.has(name)),
    ...contents.names
      .filter(
        (name) =>
          /^Metadata\/plate_1(?:_small)?\.(?:png|jpe?g)$/i.test(name) && !CANDIDATES.includes(name),
      )
      .sort(),
  ];

  for (const name of ordered) {
    const data = contents.files.get(name);
    if (!data || data.length === 0 || data.length > MAX_THUMBNAIL_BYTES) continue;
    const mime = imageMime(data);
    if (!mime) continue;
    return { data, mime, name };
  }
  return undefined;
}
