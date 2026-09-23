import { describe, expect, it } from 'vitest';
import {
  clampPlaceFormValues,
  placeInfoToFormValues,
  PLACE_FIELD_LIMITS,
} from './place-form';
import { truncateToMaxLength } from './text-limit';

describe('place form field boundaries', () => {
  it('keeps resolver store-name and address values lossless while retaining other limits', () => {
    const longCandidate = {
      sourceUrl: 'https://www.google.com/maps/place/long',
      originalName: '原始候選名稱'.repeat(20),
      googleName: 'Google 候選名稱'.repeat(20),
      address: '東京都地址😀'.repeat(40),
      category: '咖啡廳カフェ'.repeat(20),
      priceText: '¥'.repeat(40),
    };

    const values = placeInfoToFormValues(longCandidate);
    expect(values.storeName).toBe(longCandidate.originalName);
    expect(values.address).toBe(longCandidate.address);

    const formValues = clampPlaceFormValues(values);
    expect(formValues.storeName).toBe(longCandidate.originalName);
    expect(formValues.address).toBe(longCandidate.address);
    expect(formValues.category).toBe(truncateToMaxLength(longCandidate.category, PLACE_FIELD_LIMITS.category));
    expect(formValues.priceText).toBe(truncateToMaxLength(longCandidate.priceText, PLACE_FIELD_LIMITS.priceText));
    expect(clampPlaceFormValues({ ...values, reviewCount: '1000000000' }).reviewCount).toBe('999999999');
    expect(PLACE_FIELD_LIMITS).not.toHaveProperty('storeName');
    expect(PLACE_FIELD_LIMITS).not.toHaveProperty('address');
    expect(PLACE_FIELD_LIMITS).not.toHaveProperty('qrCode');
  });
});
