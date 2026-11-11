import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function parseBed(area: string[]): { width: number; height: number } {
  const points = area
    .map((entry) => entry.split('x').map(Number))
    .filter((point) => point.length === 2 && point.every(Number.isFinite)) as Array<
    [number, number]
  >;
  if (points.length === 0) return { width: 0, height: 0 };
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return {
    width: Math.round(Math.max(...xs) - Math.min(...xs)),
    height: Math.round(Math.max(...ys) - Math.min(...ys)),
  };
}
