export type Weekday =
  | '星期一'
  | '星期二'
  | '星期三'
  | '星期四'
  | '星期五'
  | '星期六'
  | '星期日';

export interface PlaceInfo {
  sourceUrl: string;
  resolvedUrl?: string;
  originalName: string;
  googleName?: string;
  rating?: number;
  reviewCount?: number;
  address?: string;
  category?: string;
  priceText?: string;
  qrCode?: string;
  weeklyHours?: Partial<Record<Weekday, string>>;
  lat?: number;
  lng?: number;
  placeId?: string;
  featureId?: string;
}
