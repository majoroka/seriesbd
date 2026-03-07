import { MediaType, Series } from './types';

type SeriesLike = Omit<Series, 'media_type'> & { media_type?: MediaType | null };

function isSeriesLike(value: unknown): value is SeriesLike {
  return typeof value === 'object' && value !== null;
}

function normalizeMediaType(value: MediaType | null | undefined): MediaType {
  if (value === 'series' || value === 'movie' || value === 'book') return value;
  return 'series';
}

export function normalizeSeries<T extends SeriesLike>(series: T): T & { media_type: MediaType } {
  return {
    ...series,
    media_type: normalizeMediaType(series.media_type),
  };
}

export function normalizeSeriesCollection(input: unknown): Series[] {
  if (!Array.isArray(input)) return [];
  return input.filter(isSeriesLike).map((entry) => normalizeSeries(entry));
}
