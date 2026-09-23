import type { PlaceInfo, Weekday } from './place-info';
import { truncateToMaxLength } from './text-limit';

export const PLACE_FIELD_LIMITS = {
  mapsUrl: 2048,
  category: 48,
  priceText: 32,
  customHours: 80,
  socialId: 64,
  reviewCount: 999_999_999,
} as const;

export interface PlaceFormValues {
  storeName: string;
  rating: string;
  reviewCount: string;
  address: string;
  category: string;
  priceText: string;
  weeklyHours?: Partial<Record<Weekday, string>>;
}

export function placeInfoToFormValues(place: PlaceInfo): PlaceFormValues {
  // Keep resolver output intact. Only fields with an explicit HTML maxlength
  // are bounded when automatic data crosses the form boundary.
  return {
    storeName: place.originalName || place.googleName || '',
    rating: place.rating === undefined ? '' : String(place.rating),
    reviewCount: place.reviewCount === undefined ? '' : String(place.reviewCount),
    address: place.address || '',
    category: place.category || '',
    priceText: place.priceText || '',
    ...(place.weeklyHours ? { weeklyHours: place.weeklyHours } : {}),
  };
}

function clampReviewCount(value: string): string {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed > PLACE_FIELD_LIMITS.reviewCount
    ? String(PLACE_FIELD_LIMITS.reviewCount)
    : value;
}

export function clampPlaceFormValues(values: PlaceFormValues): PlaceFormValues {
  return {
    ...values,
    storeName: values.storeName,
    address: values.address,
    category: truncateToMaxLength(values.category, PLACE_FIELD_LIMITS.category),
    priceText: truncateToMaxLength(values.priceText, PLACE_FIELD_LIMITS.priceText),
    reviewCount: clampReviewCount(values.reviewCount),
  };
}

export const EMPTY_PLACE_FORM_VALUES: PlaceFormValues = {
  storeName: '',
  rating: '',
  reviewCount: '',
  address: '',
  category: '',
  priceText: '',
};
