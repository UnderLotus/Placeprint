import { describe, expect, it } from 'vitest';
import {
  InvalidHttpUrlError,
  UnrecognizedMapsUrlError,
  parseMapsUrl,
} from './maps-url';

describe('complete Maps URL parsing', () => {
  it('keeps the decoded place-path name and extracts ids and @ coordinates', () => {
    const parsed = parseMapsUrl(
      'https://www.google.co.jp/maps/place/%E3%82%AB%E3%83%95%E3%82%A7+%E3%81%82%E3%81%95%E3%81%BE/@35.68124,139.76712,17z/data=!3m1!4b1!4m8!3m7!1s0x1111:0x2222!2e0!7i13312!8i6656!9m1!1b1!16sChIJTARGET?entry=ttu&query_place_id=ChIJTARGET',
    );

    expect(parsed.sourceUrl).toContain('google.co.jp');
    expect(parsed.pathName).toBe('カフェ あさま');
    expect(parsed.query).toBeUndefined();
    expect(parsed.lat).toBeCloseTo(35.68124);
    expect(parsed.lng).toBeCloseTo(139.76712);
    expect(parsed.placeId).toBe('ChIJTARGET');
    expect(parsed.featureId).toBe('0x1111:0x2222');
    expect(parsed.spanMeters).toBe(1000);
  });

  it('uses q/query, !3d!4d, and ll in the specified order and clamps span', () => {
    const dataCoordinates = parseMapsUrl(
      'https://maps.google.com/maps/search/?query=Tea+Room!3d35.2!4d139.3!1d999999',
    );
    expect(dataCoordinates.pathName).toBeUndefined();
    expect(dataCoordinates.query).toBe('Tea Room!3d35.2!4d139.3!1d999999');
    expect(dataCoordinates.lat).toBeCloseTo(35.2);
    expect(dataCoordinates.lng).toBeCloseTo(139.3);
    expect(dataCoordinates.spanMeters).toBe(1000);

    const llCoordinates = parseMapsUrl(
      'https://www.google.com/maps/?q=Tea+Room&ll=35.4,-139.4&data=!1d12',
    );
    expect(llCoordinates.lat).toBeCloseTo(35.4);
    expect(llCoordinates.lng).toBeCloseTo(-139.4);
    expect(llCoordinates.spanMeters).toBe(1000);

    const clamped = parseMapsUrl(
      'https://www.google.com/maps/search/?q=Tea+Room&data=!1d999999',
    );
    expect(clamped.spanMeters).toBe(500000);
  });

  it('reports malformed HTTP(S) separately from a valid but unrecognized URL', () => {
    expect(() => parseMapsUrl('not a URL')).toThrow(InvalidHttpUrlError);
    expect(() => parseMapsUrl('ftp://example.com/maps/place/Tea')).toThrow(InvalidHttpUrlError);
    expect(() => parseMapsUrl('https://example.com/catalog/item/42')).toThrow(
      UnrecognizedMapsUrlError,
    );
  });

  it('does not treat a bare /maps path as a complete lookup URL', () => {
    expect(() => parseMapsUrl('https://goo.gl/maps/abc')).toThrow(
      UnrecognizedMapsUrlError,
    );
    expect(() => parseMapsUrl('https://example.com/maps/abc')).toThrow(
      UnrecognizedMapsUrlError,
    );
  });
});
