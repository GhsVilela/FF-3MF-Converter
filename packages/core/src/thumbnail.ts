import type { ZipContents } from './zip.js';

export interface ProjectThumbnail {
  data: Buffer;
  mime: 'image/png' | 'image/jpeg';
  name: string;
  plate: number;
}

const MAX_THUMBNAIL_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_THUMBNAIL_BYTES = 24 * 1024 * 1024;
const MAX_THUMBNAILS = 64;

const GENERIC_CANDIDATES = [
  'Metadata/thumbnail.png',
  'Metadata/thumbnail.jpg',
  'Auxiliaries/.thumbnails/thumbnail_3mf.png',
  'Auxiliaries/.thumbnails/thumbnail_middle.png',
  'Auxiliaries/.thumbnails/thumbnail_small.png',
];

function plateCandidates(plate: number): string[] {
  return [
    `Metadata/plate_${plate}.png`,
    `Metadata/plate_${plate}.jpg`,
    `Metadata/plate_${plate}.jpeg`,
    `Metadata/plate_${plate}_small.png`,
    `Metadata/plate_${plate}_small.jpg`,
    `Metadata/plate_no_light_${plate}.png`,
    `Metadata/top_${plate}.png`,
  ];
}

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

function readThumbnail(
  contents: ZipContents,
  names: Set<string>,
  candidates: string[],
  plate: number,
): ProjectThumbnail | undefined {
  for (const name of candidates) {
    if (!names.has(name)) continue;
    const data = contents.files.get(name);
    if (!data || data.length === 0 || data.length > MAX_THUMBNAIL_BYTES) continue;
    const mime = imageMime(data);
    if (!mime) continue;
    return { data, mime, name, plate };
  }
  return undefined;
}

/**
 * Return every plate preview embedded in a 3MF package, ordered by plate.
 * Some packages only contain a single project thumbnail; those are exposed as
 * plate 1 so the UI can still show a useful preview.
 */
export function findProjectThumbnails(contents: ZipContents): ProjectThumbnail[] {
  const names = new Set(contents.names);
  const plateNumbers = new Set<number>();
  for (const name of contents.names) {
    const match = /^Metadata\/(?:plate|plate_no_light|top)_(\d+)(?:_small)?\.(?:png|jpe?g)$/i.exec(
      name,
    );
    if (!match) continue;
    const plate = Number(match[1]);
    if (Number.isInteger(plate) && plate > 0) plateNumbers.add(plate);
  }

  const thumbnails: ProjectThumbnail[] = [];
  let totalBytes = 0;
  if (plateNumbers.size > 0) {
    for (const plate of [...plateNumbers].sort((left, right) => left - right)) {
      const thumbnail = readThumbnail(contents, names, plateCandidates(plate), plate);
      if (!thumbnail) continue;
      if (thumbnails.length >= MAX_THUMBNAILS) break;
      if (totalBytes + thumbnail.data.length > MAX_TOTAL_THUMBNAIL_BYTES) break;
      totalBytes += thumbnail.data.length;
      thumbnails.push(thumbnail);
    }
  }

  if (thumbnails.length === 0) {
    const fallback = readThumbnail(contents, names, GENERIC_CANDIDATES, 1);
    if (fallback) thumbnails.push(fallback);
  }

  return thumbnails;
}
