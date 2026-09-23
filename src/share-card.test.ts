import { describe, expect, it } from 'vitest';
import {
  beginImageLoad,
  canDownload,
  completeImageLoad,
  failImageLoad,
} from './image-load-state';
import { segmentGraphemes } from './grapheme';
import { hasExportablePlaceContent, renderShareCard } from './share-card';
import { createShareCardCanvas } from './test-support/share-card-canvas';

function line(plan: ReturnType<typeof renderShareCard>, kind: 'name' | 'rating' | 'category' | 'hours' | 'address' | 'social') {
  return plan.infoLayout?.lineBoxes.find((box) => box.kind === kind);
}

describe('Ticket26 fixed QR anchor states', () => {
  const states = [
    {
      state: 'social takes priority over address',
      content: { socialId: '  @place  ', address: 'Address is also present' },
      y: 1617,
      visualY: 1659,
      visualBottom: 1862,
    },
    {
      state: 'one-line address uses the second full-layout slot',
      content: { address: 'One-line address' },
      y: 1584,
      visualY: 1626,
      visualBottom: 1829,
    },
    {
      state: 'two-line address uses the same second full-layout slot',
      content: { address: '路'.repeat(52) },
      y: 1584,
      visualY: 1626,
      visualBottom: 1829,
    },
    {
      state: 'other body content without social or address uses first address slot',
      content: { storeName: 'Name without footer fields' },
      y: 1532,
      visualY: 1574,
      visualBottom: 1777,
    },
    {
      state: 'QR-only uses first address slot',
      content: {},
      y: 1532,
      visualY: 1574,
      visualBottom: 1777,
    },
  ] as const;

  it.each(states)('$state', ({ content, y, visualY, visualBottom, state }) => {
    const plan = renderShareCard(createShareCardCanvas().canvas, {
      ...content,
      qrCode: 'ticket26 geometry',
    });
    const box = plan.qrCodeBox!;

    expect(box).toMatchObject({
      x: 1184,
      y,
      size: 288,
      visualX: 1226,
      visualY,
      visualSize: 203,
    });
    expect(box.visualY + box.visualSize).toBe(visualBottom);
    expect(box.visualX - box.x).toBe(42);
    expect(box.visualY - box.y).toBe(42);
    expect(box.x + box.size - (box.visualX + box.visualSize)).toBe(43);
    expect(box.y + box.size - (box.visualY + box.visualSize)).toBe(43);
    if (state.startsWith('one-line')) expect(line(plan, 'address')?.lines).toHaveLength(1);
    if (state.startsWith('two-line')) expect(line(plan, 'address')?.lines).toHaveLength(2);
  });

  it('treats whitespace-only social and address as absent', () => {
    const plan = renderShareCard(createShareCardCanvas().canvas, {
      socialId: '  \n\t ',
      address: ' \t  ',
      qrCode: 'whitespace branch',
    });

    expect(line(plan, 'social')).toBeUndefined();
    expect(line(plan, 'address')).toBeUndefined();
    expect(plan.qrCodeBox).toMatchObject({ y: 1532, visualY: 1574 });
  });

  it('keeps fixed QR anchor independent of omitted main-body fields', () => {
    const cases = [
      { storeName: 'Name only', qrCode: 'one payload' },
      { rating: 4.8, category: 'Category', hoursText: 'Hours', qrCode: 'another payload' },
    ];
    const plans = cases.map((content, index) => {
      const { canvas } = createShareCardCanvas({
        measureText: (text, font) => font.includes('38px') && text === 'Ág'
          ? { actualBoundingBoxAscent: index === 0 ? 11 : 31, actualBoundingBoxDescent: index === 0 ? 2 : 9 }
          : {},
      });
      return renderShareCard(canvas, content);
    });

    expect(plans.map((plan) => plan.qrCodeBox?.y)).toEqual([1532, 1532]);
    expect(plans.map((plan) => plan.qrCodeBox?.visualY)).toEqual([1574, 1574]);
    expect(plans[0].infoLayout?.lineBoxes.map(({ kind }) => kind)).toEqual(['name']);
    expect(plans[1].infoLayout?.lineBoxes.map(({ kind }) => kind)).toEqual(['rating', 'category', 'hours']);
    expect(plans[0].infoLayout?.mainBottom).not.toBe(plans[1].infoLayout?.mainBottom);
  });

  it('ignores controlled address and social ink metrics when selecting fixed anchors', () => {
    const addresses = [12, 31].map((ascent, index) => {
      const { canvas } = createShareCardCanvas({
        measureText: (text, font) => font.includes('38px') && text === 'Ág'
          ? { actualBoundingBoxAscent: ascent, actualBoundingBoxDescent: index === 0 ? 1 : 9 }
          : {},
      });
      return renderShareCard(canvas, { address: 'Ág', qrCode: 'address metrics' });
    });
    const socials = [17, 31].map((ascent, index) => {
      const { canvas } = createShareCardCanvas({
        measureText: (text, font) => font.includes('42px') && text === 'gypq'
          ? { actualBoundingBoxAscent: ascent, actualBoundingBoxDescent: index === 0 ? 2 : 9 }
          : {},
      });
      return renderShareCard(canvas, { socialId: 'gypq', qrCode: 'social metrics' });
    });

    expect(addresses.map((plan) => plan.qrCodeBox?.y)).toEqual([1584, 1584]);
    expect(addresses.map((plan) => plan.qrCodeBox?.visualY)).toEqual([1626, 1626]);
    expect(addresses[0].infoLayout?.lineBoxes.find((box) => box.kind === 'address')?.inkBottom)
      .not.toBe(addresses[1].infoLayout?.lineBoxes.find((box) => box.kind === 'address')?.inkBottom);
    expect(socials.map((plan) => plan.qrCodeBox?.y)).toEqual([1617, 1617]);
    expect(socials.map((plan) => plan.qrCodeBox?.visualY)).toEqual([1659, 1659]);
    expect(socials[0].infoLayout?.lineBoxes.find((box) => box.kind === 'social')?.top)
      .not.toBe(socials[1].infoLayout?.lineBoxes.find((box) => box.kind === 'social')?.top);
  });

  it('keeps QR coordinates identical across payload sizes within the selected state', () => {
    const plans = ['x', 'https://example.com/longer-ticket26-payload'].map((qrCode) =>
      renderShareCard(createShareCardCanvas().canvas, {
        address: 'Address',
        qrCode,
      }),
    );

    expect(plans[0].qrCodeBox).toMatchObject({ x: 1184, y: 1584, size: 288, visualX: 1226, visualY: 1626, visualSize: 203 });
    expect(plans[1].qrCodeBox).toMatchObject({ x: 1184, y: 1584, size: 288, visualX: 1226, visualY: 1626, visualSize: 203 });
    expect(plans[0].qrCodeBox?.moduleCount).not.toBe(plans[1].qrCodeBox?.moduleCount);
  });
});

describe('Ticket23 visual footer layout', () => {
  it('keeps the 1536x1919 canvas and fixed field geometry', () => {
    const { canvas } = createShareCardCanvas();
    const plan = renderShareCard(canvas, {
      storeName: '海風書店',
      rating: 4.8,
      reviewCount: 12,
      category: '獨立書店',
      priceText: '$$',
      hoursText: '平日 10:00~20:30',
      address: '路'.repeat(52),
      socialId: '@harbor',
      qrCode: 'footer qr',
    });

    expect({ width: plan.width, height: plan.height }).toEqual({ width: 1536, height: 1919 });
    expect(plan.photo).toEqual({ x: 0, y: 0, width: 1536, height: 1229 });
    expect(plan.info).toEqual({ x: 0, y: 1229, width: 1536, height: 690 });
    expect(plan.name.x).toBe(128);
    expect(plan.name.maxWidth).toBe(1280);
    expect(plan.infoLayout?.fieldGap).toBe(24);
    expect(line(plan, 'name')).toMatchObject({ x: 128, top: 1341, width: 1280, height: 120 });
    expect(line(plan, 'rating')).toMatchObject({ x: 128, width: 1032, top: 1485, height: 62 });
    expect(line(plan, 'category')).toMatchObject({ x: 128, width: 1032, top: 1571, height: 54 });
    expect(line(plan, 'hours')).toMatchObject({ x: 128, width: 1032, top: 1649, height: 52 });
    expect(line(plan, 'address')).toMatchObject({ x: 128, width: 1032, top: 1725, height: 104 });
    expect(line(plan, 'social')).toMatchObject({ x: 128, width: 1032, height: 48 });
    expect(line(plan, 'address')!.top + line(plan, 'address')!.height).toBe(1829);
    expect(line(plan, 'social')!.inkBottom).toBe(1862);
    expect(line(plan, 'social')!.inkMetrics[0].baseline + line(plan, 'social')!.inkMetrics[0].descent).toBe(1862);
    expect(plan.infoLayout?.mainBottom).toBe(1829);
    expect(plan.infoLayout!.socialTop).toBe(line(plan, 'social')!.top);
    expect(plan.infoLayout!.socialInkBottom).toBe(1862);
    expect(plan.qrCodeBox).toMatchObject({ x: 1184, y: 1617, size: 288, visualX: 1226, visualY: 1659, visualSize: 203 });
    expect(plan.qrCodeBox!.y + plan.qrCodeBox!.size).toBe(1905);
  });

  it('does not reserve a slot for missing fields', () => {
    const { canvas } = createShareCardCanvas();
    const plan = renderShareCard(canvas, { address: '地址' });
    expect(line(plan, 'address')).toMatchObject({ top: 1341, x: 128, width: 1032 });
    expect(plan.infoLayout?.lineBoxes).toHaveLength(1);
  });

  it('keeps social-only output on the fixed footer seam', () => {
    const { canvas } = createShareCardCanvas();
    const plan = renderShareCard(canvas, { socialId: '  @only-social  ' });
    expect(line(plan, 'social')).toMatchObject({ text: '@only-social', x: 128, width: 1032, height: 48 });
    expect(line(plan, 'social')!.inkBottom).toBe(1862);
    expect(plan.infoLayout?.socialInkBottom).toBe(1862);
    expect(plan.infoLayout?.lineBoxes).toHaveLength(1);
  });

  it('keeps main geometry unchanged when social is added', () => {
    const withoutSocial = renderShareCard(createShareCardCanvas().canvas, { storeName: '店' });
    const withSocial = renderShareCard(createShareCardCanvas().canvas, {
      storeName: '店',
      socialId: '@x',
    });

    expect(withSocial.infoLayout?.mainTop).toBe(withoutSocial.infoLayout?.mainTop);
    expect(withSocial.infoLayout?.mainBottom).toBe(withoutSocial.infoLayout?.mainBottom);
    expect(withoutSocial.infoLayout?.mainBottom).toBe(1461);
    expect(line(withSocial, 'social')).toMatchObject({ text: '@x', height: 48 });
    expect(line(withSocial, 'social')!.inkBottom).toBe(1862);
    expect(withSocial.infoLayout?.socialInkBottom).toBe(1862);
  });
});

describe('Ticket23 measured social ink seam', () => {
  const metricCases = [
    { label: 'descender', value: 'gypq', ascent: 27, descent: 14 },
  ];

  it.each(metricCases)('anchors $label social ink at 1862 with one stored baseline', ({ value, ascent, descent }) => {
    const { canvas, recording } = createShareCardCanvas({
      measureText: (text, font) => font.includes('42px') && text === value
        ? { actualBoundingBoxAscent: ascent, actualBoundingBoxDescent: descent }
        : {},
    });
    const plan = renderShareCard(canvas, { socialId: value });
    const social = line(plan, 'social')!;
    const metrics = social.inkMetrics[0];
    const draw = recording.fillText.find((call) => call.text === value)!;

    expect(social.inkBottom).toBe(1862);
    expect(metrics.baseline).toBe(1862 - descent);
    expect(metrics.baseline + metrics.descent).toBe(1862);
    expect(draw.y).toBe(metrics.baseline);
    expect(plan.infoLayout?.socialTop).toBe(social.top);
    expect(plan.infoLayout?.socialInkBottom).toBe(1862);
  });

  it('uses the same visual footer anchor for social-only and full address layouts', () => {
    const measureText = (text: string, font: string) => font.includes('42px') && text === '@same-anchor'
      ? { actualBoundingBoxAscent: 31, actualBoundingBoxDescent: 9 }
      : {};
    const socialOnly = renderShareCard(
      createShareCardCanvas({ measureText }).canvas,
      { socialId: '@same-anchor' },
    );
    const full = renderShareCard(
      createShareCardCanvas({ measureText }).canvas,
      { address: '路'.repeat(52), socialId: '@same-anchor' },
    );

    expect(line(socialOnly, 'social')?.inkBottom).toBe(1862);
    expect(line(full, 'social')?.inkBottom).toBe(1862);
    expect(line(full, 'social')?.baseline).toBe(line(socialOnly, 'social')?.baseline);
  });

  it('accepts finite signed social actual bounds, including a negative descent', () => {
    const { canvas, recording } = createShareCardCanvas({
      measureText: (text, font) => font.includes('42px') && text === '---'
        ? { actualBoundingBoxAscent: 7, actualBoundingBoxDescent: -3 }
        : {},
    });
    const plan = renderShareCard(canvas, { socialId: '---' });
    const social = line(plan, 'social')!;
    const metrics = social.inkMetrics[0];
    const draw = recording.fillText.find((call) => call.text === '---')!;

    expect(social.fontSize).toBe(42);
    expect(social.lineHeight).toBe(48);
    expect(metrics.ascent).toBe(7);
    expect(metrics.descent).toBe(-3);
    expect(metrics.baseline).toBe(1865);
    expect(metrics.baseline + metrics.descent).toBe(1862);
    expect(social.inkBottom).toBe(1862);
    expect(draw.y).toBe(1865);
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY])(
    'falls back only for missing or non-finite social actual bounds (%s)',
    (invalid) => {
      const { canvas } = createShareCardCanvas({
        measureText: (text, font) => font.includes('42px') && text === '@fallback'
          ? { actualBoundingBoxAscent: invalid, actualBoundingBoxDescent: invalid }
          : {},
      });
      const plan = renderShareCard(canvas, { socialId: '@fallback' });
      const social = line(plan, 'social')!;
      const metrics = social.inkMetrics[0];

      expect(social.fontSize).toBe(42);
      expect(social.lineHeight).toBe(48);
      expect(metrics.ascent).toBe(33.6);
      expect(metrics.descent).toBe(8.4);
      expect(metrics.baseline).toBeCloseTo(1853.6);
      expect(metrics.baseline + metrics.descent).toBeCloseTo(1862);
    },
  );

  it('keeps normal body metric fallback behavior separate from signed social metrics', () => {
    const { canvas } = createShareCardCanvas({
      measureText: (text, font) => font.includes('38px') && text === '正文'
        ? {
            actualBoundingBoxAscent: -4,
            actualBoundingBoxDescent: -2,
            fontBoundingBoxAscent: 30,
            fontBoundingBoxDescent: 8,
          }
        : {},
    });
    const plan = renderShareCard(canvas, { address: '正文' });
    const address = line(plan, 'address')!;

    expect(address.inkMetrics[0].ascent).toBe(30);
    expect(address.inkMetrics[0].descent).toBe(8);
    expect(address.inkBottom).toBe(1379.4);
  });

  it.each([0, 0.5, 1])('keeps full two-line address clear of fixed-size Ág social animation at progress %s', (progress) => {
    const { canvas, recording } = createShareCardCanvas();
    const plan = renderShareCard(
      canvas,
      {
        storeName: 'Ticket 23 Place',
        rating: 4.8,
        reviewCount: 125,
        category: '獨立書店',
        priceText: '$$',
        hoursText: '平日 10:00~20:30',
        address: '路'.repeat(52),
        socialId: 'Ág',
        qrCode: 'https://example.com/ticket23/general',
      },
      {
        textAnimation: {
          kind: 'social',
          ranges: [{ lineIndex: 0, start: 0, end: 1 }],
          progress,
        },
      },
    );
    const address = line(plan, 'address')!;
    const social = line(plan, 'social')!;
    const addressRegions = address.inkMetrics.map((metrics, index) => ({
      top: Math.max(address.top + index * address.lineHeight, metrics.inkTop),
      bottom: Math.min(address.top + (index + 1) * address.lineHeight, metrics.inkBottom),
    }));
    const paperMasks = recording.fillRect.filter((call) =>
      call.fillStyle === '#fbfbf6' && call.width > 0 && call.width < 1032,
    );

    expect(social.fontSize).toBe(42);
    expect(social.lineHeight).toBe(48);
    expect(social.inkBottom).toBe(1862);
    expect(social.inkTop).toBeGreaterThan(address.inkBottom);
    for (const mask of paperMasks) {
      for (const region of addressRegions) {
        expect(mask.y + mask.height <= region.top || mask.y >= region.bottom).toBe(true);
      }
    }
    for (const call of recording.fillText.filter((entry) => entry.text === 'Ág')) {
      expect(call.clip).not.toBeNull();
      expect(call.clip!.y).toBeGreaterThanOrEqual(social.inkTop);
      expect(call.clip!.y + call.clip!.height).toBeLessThanOrEqual(social.inkBottom);
    }
  });
});

describe('Ticket25 fixed body baselines', () => {
  it('uses the fixed Ág ascent for 100px a and aA while retaining actual ink metrics', () => {
    const measureText = (text: string, font: string) => {
      if (!font.includes('100px')) {
        return {};
      }
      if (text === 'Ág') {
        return { actualBoundingBoxAscent: 74, actualBoundingBoxDescent: 16 };
      }
      if (text === 'a') {
        return { actualBoundingBoxAscent: 42, actualBoundingBoxDescent: 5 };
      }
      if (text === 'aA') {
        return { actualBoundingBoxAscent: 61, actualBoundingBoxDescent: 7 };
      }
      return {};
    };
    const first = renderShareCard(
      createShareCardCanvas({ measureText }).canvas,
      { storeName: 'a' },
    );
    const second = renderShareCard(
      createShareCardCanvas({ measureText }).canvas,
      { storeName: 'aA' },
    );
    const firstName = line(first, 'name')!;
    const secondName = line(second, 'name')!;

    expect(firstName.baseline).toBe(1415);
    expect(secondName.baseline).toBe(firstName.baseline);
    expect(firstName.inkMetrics[0]).toMatchObject({
      ascent: 42,
      descent: 5,
      baseline: 1415,
      inkTop: 1373,
      inkBottom: 1420,
    });
    expect(secondName.inkMetrics[0]).toMatchObject({
      ascent: 61,
      descent: 7,
      baseline: 1415,
      inkTop: 1354,
      inkBottom: 1422,
    });
  });

  it.each([
    ['Ág', 31, 8],
    ['台北', 22, 3],
    ['gypq', 19, 9],
  ])('keeps a fixed 38px baseline for %s without erasing actual ink metrics', (text, ascent, descent) => {
    const measureText = (measuredText: string, font: string) => {
      if (!font.includes('38px')) {
        return {};
      }
      if (measuredText === 'Ág') {
        return { actualBoundingBoxAscent: 31, actualBoundingBoxDescent: 8 };
      }
      if (measuredText === '台北') {
        return { actualBoundingBoxAscent: 22, actualBoundingBoxDescent: 3 };
      }
      if (measuredText === 'gypq') {
        return { actualBoundingBoxAscent: 19, actualBoundingBoxDescent: 9 };
      }
      return {};
    };
    const plan = renderShareCard(
      createShareCardCanvas({ measureText }).canvas,
      { address: text },
    );
    const address = line(plan, 'address')!;

    expect(address.baseline).toBe(1372);
    expect(address.inkMetrics[0]).toMatchObject({
      ascent,
      descent,
      baseline: 1372,
      inkTop: 1372 - ascent,
      inkBottom: 1372 + descent,
    });
  });

  it('keeps the final baseline fixed at animation progress 0 and moves only the inserted range by 8px', () => {
    const measureText = (text: string, font: string) => {
      if (!font.includes('100px')) {
        return {};
      }
      if (text === 'Ág') {
        return { actualBoundingBoxAscent: 74, actualBoundingBoxDescent: 16 };
      }
      if (text === 'aA') {
        return { actualBoundingBoxAscent: 61, actualBoundingBoxDescent: 7 };
      }
      return {};
    };
    const final = renderShareCard(
      createShareCardCanvas({ measureText }).canvas,
      { storeName: 'aA' },
    );
    const animatedFixture = createShareCardCanvas({ measureText });
    const animated = renderShareCard(
      animatedFixture.canvas,
      { storeName: 'aA' },
      {
        textAnimation: {
          kind: 'name',
          ranges: [{ lineIndex: 0, start: 1, end: 2 }],
          progress: 0,
        },
      },
    );
    const finalName = line(final, 'name')!;
    const animatedName = line(animated, 'name')!;
    const calls = animatedFixture.recording.fillText.filter((call) => call.text === 'aA');

    expect(animatedName.baseline).toBe(finalName.baseline);
    expect(calls).toHaveLength(2);
    expect(calls[0].y).toBe(finalName.baseline);
    expect(calls[1].y).toBe(finalName.baseline + 8);
  });
});

describe('Ticket18 Canvas text ink seam', () => {
  it('keeps every measured glyph bound inside its fixed line box', () => {
    const { canvas, recording } = createShareCardCanvas();
    renderShareCard(canvas, {
      storeName: 'animate 台北店',
      rating: 4.5,
      reviewCount: 11041,
      category: '漫畫店',
      hoursText: '平日 12:00–22:00',
      address: '路'.repeat(52),
      socialId: '@animate',
    });

    expect(recording.fillText.length).toBeGreaterThan(0);
    for (const fill of recording.fillText) {
      expect(fill.textBaseline).toBe('alphabetic');
      expect(fill.clip).not.toBeNull();
      const clip = fill.clip!;
      const inkTop = fill.y - fill.actualBoundingBoxAscent;
      const inkBottom = fill.y + fill.actualBoundingBoxDescent;
      expect(inkTop).toBeGreaterThanOrEqual(clip.y - 1e-9);
      expect(inkBottom).toBeLessThanOrEqual(clip.y + clip.height + 1e-9);
    }
  });

  it('clips synthetic oversized ink for the name and two-line address', () => {
    const { canvas, recording } = createShareCardCanvas({
      measureText: () => ({
        actualBoundingBoxAscent: 130,
        actualBoundingBoxDescent: 20,
      }),
    });
    const plan = renderShareCard(canvas, {
      storeName: '店',
      address: '路'.repeat(52),
    });
    const lineBoxes = plan.infoLayout?.lineBoxes ?? [];

    expect(lineBoxes.map((box) => box.kind)).toEqual(['name', 'address']);
    expect(lineBoxes.find((box) => box.kind === 'address')?.lines).toHaveLength(2);
    expect(recording.clip).toEqual(
      lineBoxes.map((box) => ({
        x: box.x,
        y: box.top,
        width: box.width,
        height: box.height,
      })),
    );
    expect(recording.fillText).toHaveLength(3);

    for (const fill of recording.fillText) {
      const lineBox = lineBoxes.find((box) => box.lines.includes(fill.text));
      expect(lineBox).toBeDefined();
      expect(fill.clip).toEqual({
        x: lineBox!.x,
        y: lineBox!.top,
        width: lineBox!.width,
        height: lineBox!.height,
      });
      expect(fill.actualBoundingBoxAscent + fill.actualBoundingBoxDescent)
        .toBeGreaterThan(lineBox!.lineHeight);
    }
  });
});

describe('Ticket19 preview-only Canvas animation', () => {
  it('keeps one final-shaped full-line draw while masking only the inserted range', () => {
    const { canvas, recording } = createShareCardCanvas();
    const plan = renderShareCard(
      canvas,
      { storeName: 'A😀B', rating: 4.8 },
      {
        textAnimation: {
          kind: 'name',
          ranges: [{ lineIndex: 0, start: 1, end: 2 }],
          progress: 0,
        },
      },
    );
    const name = line(plan, 'name')!;
    const nameCalls = recording.fillText.filter((call) => call.text === 'A😀B');
    const baseline = name.top + 80;
    const mask = recording.fillRect.find((call) => call.fillStyle === '#fbfbf6' && call.y === name.top);

    expect(nameCalls).toHaveLength(2);
    expect(nameCalls[0]).toMatchObject({ globalAlpha: 1, y: baseline, x: 128 });
    expect(nameCalls[1]).toMatchObject({ globalAlpha: 0, y: baseline + 8, x: 128 });
    expect(nameCalls[0].clip).toEqual({ x: 128, y: name.top, width: name.width, height: name.height });
    expect(nameCalls[1].clip).toMatchObject({ x: mask!.x, y: name.top, width: mask!.width, height: mask!.height });
    expect(nameCalls[1].clip).not.toEqual(nameCalls[0].clip);
    expect(mask).toMatchObject({ globalAlpha: 1, fillStyle: '#fbfbf6' });
    expect(mask!.width).toBeGreaterThan(0);
    expect(recording.fillText.filter((call) => call.text !== 'A😀B').every((call) => call.globalAlpha === 1)).toBe(true);

    const final = createShareCardCanvas();
    const finalPlan = renderShareCard(final.canvas, { storeName: 'A😀B', rating: 4.8 }, {
      textAnimation: { kind: 'name', ranges: [{ lineIndex: 0, start: 1, end: 2 }], progress: 1 },
    });
    expect(final.recording.fillText.filter((call) => call.text === finalPlan.name.text)).toHaveLength(1);
    expect(final.recording.fillText.every((call) => call.globalAlpha === 1)).toBe(true);

    const defaultCanvas = createShareCardCanvas();
    renderShareCard(defaultCanvas.canvas, { storeName: 'A😀B', rating: 4.8 });
    expect(final.recording.fillText).toEqual(defaultCanvas.recording.fillText);
    expect(final.recording.fillRect).toEqual(defaultCanvas.recording.fillRect);
  });

  it('clips a wrapped animated line to its own line-height', () => {
    const { canvas, recording } = createShareCardCanvas();
    const plan = renderShareCard(canvas, { address: '甲'.repeat(28) }, {
      textAnimation: {
        kind: 'address',
        ranges: [{ lineIndex: 1, start: 0, end: 1 }],
        progress: 0.5,
      },
    });
    const address = line(plan, 'address')!;
    const addressCalls = recording.fillText.filter((call) => call.text === address.lines[1]);
    expect(addressCalls.length).toBe(2);
    expect(addressCalls[1].clip).toEqual({
      x: address.x,
      y: address.inkMetrics[1].inkTop,
      width: 38,
      height: address.inkMetrics[1].inkBottom - address.inkMetrics[1].inkTop,
    });
  });

  it('restores text color across animated and unanimated wrapped lines in either order', () => {
    for (const animatedLineIndex of [0, 1]) {
      const { canvas, recording } = createShareCardCanvas();
      const plan = renderShareCard(canvas, { address: '甲'.repeat(28) }, {
        textAnimation: {
          kind: 'address',
          ranges: [{ lineIndex: animatedLineIndex, start: 0, end: 1 }],
          progress: 0.5,
        },
      });
      const address = line(plan, 'address')!;
      const unanimatedLine = address.lines[animatedLineIndex === 0 ? 1 : 0];
      const calls = recording.fillText.filter((call) => call.text === unanimatedLine);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ fillStyle: '#547277', globalAlpha: 1 });
      expect(calls[0].y).toBe(
        address.inkMetrics[animatedLineIndex === 0 ? 1 : 0].baseline,
      );
    }
  });

  it('keeps TT-to-ToT suffix shaping at the full-line x position', () => {
    const { canvas, recording } = createShareCardCanvas();
    renderShareCard(canvas, { storeName: 'ToT' }, {
      textAnimation: {
        kind: 'name',
        ranges: [{ lineIndex: 0, start: 1, end: 2 }],
        progress: 0.5,
      },
    });
    const calls = recording.fillText.filter((call) => call.text === 'ToT');
    expect(calls.length).toBe(2);
    expect(calls.every((call) => call.x === 128)).toBe(true);
    expect(calls[0].globalAlpha).toBe(1);
    expect(calls[1].globalAlpha).toBe(0.5);
    expect(calls[1].y).toBe(calls[0].y + 4);
  });

  it('keeps default preview and QR output fully opaque while animating only QR modules when requested', () => {
    const final = createShareCardCanvas();
    renderShareCard(final.canvas, {
      storeName: 'Visible',
      qrCode: 'https://example.com/qr',
    });
    expect(final.recording.fillText.every((call) => call.globalAlpha === 1)).toBe(true);
    expect(final.recording.fillRect.every((call) => call.globalAlpha === 1)).toBe(true);

    const animated = createShareCardCanvas();
    const plan = renderShareCard(
      animated.canvas,
      { storeName: 'Visible', qrCode: 'https://example.com/qr' },
      { qrAnimationProgress: 0.25 },
    );
    const qrFills = animated.recording.fillRect.filter(
      (call) => call.x >= plan.qrCodeBox!.x && call.y >= plan.qrCodeBox!.y,
    );
    expect(qrFills.length).toBeGreaterThan(0);
    expect(qrFills.every((call) => call.globalAlpha === 0.25)).toBe(true);
    expect(animated.recording.fillText.every((call) => call.globalAlpha === 1)).toBe(true);
  });
});

describe('Ticket18 grapheme-safe typography', () => {
  it.each([
    [12, 100],
    [13, undefined],
    [24, undefined],
    [25, undefined],
  ])('renders a %s-grapheme name on one line without ellipsis', (count, expectedSize) => {
    const value = '店'.repeat(count);
    const { canvas, context } = createShareCardCanvas();
    const plan = renderShareCard(canvas, { storeName: value });
    const name = line(plan, 'name')!;

    expect(name.lines).toHaveLength(1);
    expect(segmentGraphemes(name.lines[0])).toHaveLength(Math.min(count, 24));
    expect(name.lines[0]).not.toContain('…');
    expect(name.top).toBe(1341);
    expect(name.lineHeight).toBe(120);
    expect(name.width).toBe(1280);
    context.font = name.font;
    expect(context.measureText(name.lines[0]).width).toBeLessThanOrEqual(1280);
    if (expectedSize !== undefined) {
      expect(name.fontSize).toBe(expectedSize);
    } else {
      expect(name.fontSize).toBeLessThanOrEqual(100);
      expect(name.fontSize).toBeGreaterThan(0);
    }
  });

  it('normalizes whitespace and keeps combining, flag, skin-tone, and ZWJ clusters intact', () => {
    const value = '  e\u0301  🇯🇵  👍🏽  👩‍💻\n下一站  ';
    const { canvas } = createShareCardCanvas();
    const plan = renderShareCard(canvas, { storeName: value });
    const name = line(plan, 'name')!;

    expect(name.lines).toEqual(['e\u0301 🇯🇵 👍🏽 👩‍💻 下一站']);
    expect(segmentGraphemes(name.lines[0])).toEqual(['e\u0301', ' ', '🇯🇵', ' ', '👍🏽', ' ', '👩‍💻', ' ', '下', '一', '站']);
  });
});

describe('Ticket27 width-measured address wrapping and omission', () => {
  it('keeps 54 full-width graphemes that exactly fill two measured lines', () => {
    const { canvas, context } = createShareCardCanvas();
    const plan = renderShareCard(canvas, { address: '路'.repeat(54) });
    const address = line(plan, 'address')!;
    context.font = address.font;

    expect(address.lines).toHaveLength(2);
    expect(segmentGraphemes(address.lines.join(''))).toHaveLength(54);
    expect(address.lines.join('')).not.toContain('…');
    expect(address.lines.every((text) => context.measureText(text).width <= 1032)).toBe(true);
    expect(address.fontSize).toBe(38);
    expect(address.lineHeight).toBe(52);
  });

  it('adds an ellipsis when the third measured line contains only one grapheme', () => {
    const { canvas, context } = createShareCardCanvas();
    const plan = renderShareCard(canvas, { address: '路'.repeat(55) });
    const address = line(plan, 'address')!;
    context.font = address.font;

    expect(address.lines).toHaveLength(2);
    expect(address.lines[1].endsWith('…')).toBe(true);
    expect(segmentGraphemes(address.lines.join(''))).toHaveLength(54);
    expect(address.lines.every((text) => context.measureText(text).width <= 1032)).toBe(true);
    expect(address.lines.join('')).not.toBe('路'.repeat(55));
  });

  it('keeps a narrow Latin address over 52 graphemes complete across two lines', () => {
    const value = 'i'.repeat(100);
    const { canvas, context } = createShareCardCanvas({
      measureText: (text, font) => font.includes('38px')
        ? { width: segmentGraphemes(text).length * 11 }
        : {},
    });
    const plan = renderShareCard(canvas, { address: value });
    const address = line(plan, 'address')!;
    context.font = address.font;

    expect(segmentGraphemes(value)).toHaveLength(100);
    expect(address.lines).toHaveLength(2);
    expect(address.lines.join('')).toBe(value);
    expect(address.lines.join('')).not.toContain('…');
    expect(address.lines.every((text) => context.measureText(text).width <= 1032)).toBe(true);
  });

  it('does not mistake a second-line boundary space for the end of overflow', () => {
    const { canvas } = createShareCardCanvas({
      measureText: (text, font) => font.includes('38px')
        ? { width: segmentGraphemes(text).length * 300 }
        : {},
    });
    const plan = renderShareCard(canvas, { address: 'abc def ghi' });
    const address = line(plan, 'address')!;

    expect(address.lines).toHaveLength(2);
    expect(address.lines).toEqual(['abc', 'de…']);
  });

  it('ignores trailing trim-only whitespace when deciding whether a third line exists', () => {
    const { canvas } = createShareCardCanvas();
    const plan = renderShareCard(canvas, { address: '路'.repeat(54) + '  \n\t ' });
    const address = line(plan, 'address')!;

    expect(address.lines).toHaveLength(2);
    expect(address.lines.join('')).toBe('路'.repeat(54));
    expect(address.lines.join('')).not.toContain('…');
  });

  it('keeps Unicode grapheme clusters intact at wrap and ellipsis boundaries', () => {
    const combining = 'e\u0301';
    const flag = '🇯🇵';
    const skinTone = '👍🏽';
    const emoji = '👩‍💻';
    const { canvas } = createShareCardCanvas({
      measureText: (text, font) => font.includes('38px')
        ? { width: segmentGraphemes(text).reduce((width, grapheme) => width + (grapheme === ' ' ? 50 : 200), 0) }
        : {},
    });
    const value = 'A ' + combining + ' ' + flag + ' ' + skinTone + ' ' + emoji + ' Q Z ' + combining + ' Q';
    const plan = renderShareCard(canvas, { address: value });
    const address = line(plan, 'address')!;

    expect(address.lines).toHaveLength(2);
    expect(address.lines).toEqual([
      'A ' + combining + ' ' + flag + ' ' + skinTone,
      emoji + ' Q Z …',
    ]);
    expect(segmentGraphemes(address.lines[0])).toEqual(['A', ' ', combining, ' ', flag, ' ', skinTone]);
    expect(segmentGraphemes(address.lines[1])).toEqual([emoji, ' ', 'Q', ' ', 'Z', ' ', '…']);
  });

  it('stops measuring a very long address shortly after confirming third-line overflow', () => {
    const value = '路'.repeat(10_000);
    let addressMeasureCalls = 0;
    const { canvas } = createShareCardCanvas({
      measureText: (text, font) => {
        if (!font.includes('38px')) return {};
        addressMeasureCalls += 1;
        return { width: Array.from(text).length * 38 };
      },
    });
    const plan = renderShareCard(canvas, { address: value });
    const address = line(plan, 'address')!;

    expect(address.lines).toHaveLength(2);
    expect(address.lines[1].endsWith('…')).toBe(true);
    expect(addressMeasureCalls).toBeLessThan(200);
    expect(addressMeasureCalls).toBeLessThan(value.length / 10);
  });

  it('greedily wraps a short value by measured width and omits the overflow', () => {
    const value = '路'.repeat(40);
    const { canvas, context } = createShareCardCanvas({
      measureText: (text, font) => font.includes('38px')
        ? { width: text.length * 60 }
        : {},
    });
    const plan = renderShareCard(canvas, { address: value });
    const address = line(plan, 'address')!;
    context.font = address.font;

    expect(segmentGraphemes(value)).toHaveLength(40);
    expect(address.lines).toHaveLength(2);
    expect(address.lines[1].endsWith('…')).toBe(true);
    expect(address.lines.every((text) => context.measureText(text).width <= 1032)).toBe(true);
  });

  it('keeps the original value outside the renderer output copy', () => {
    const original = '  路\n'.repeat(40);
    const content = { address: original };
    const { canvas } = createShareCardCanvas();
    const plan = renderShareCard(canvas, content);
    expect(content.address).toBe(original);
    expect(line(plan, 'address')?.text).not.toBe(original);
  });
});

describe('Ticket18 QR geometry and final-only preview', () => {
  it('keeps fixed QR box and body geometry across successful payload sizes', () => {
    const contents = [
      'a',
      'https://example.com/this-is-a-longer-payload-for-the-qr-code',
    ];
    const plans = contents.map((qrCode) => {
      const { canvas } = createShareCardCanvas();
      return renderShareCard(canvas, {
        storeName: 'Harbor House',
        rating: 4.8,
        address: '12 Peace Road, District',
        qrCode,
      });
    });
    const first = plans[0];
    const second = plans[1];
    expect(first.qrCodeBox).toMatchObject({ x: 1184, y: 1584, size: 288, visualX: 1226, visualY: 1626, visualSize: 203 });
    expect(second.qrCodeBox).toMatchObject({ x: 1184, y: 1584, size: 288, visualX: 1226, visualY: 1626, visualSize: 203 });
    expect(first.qrCodeBox!.y + first.qrCodeBox!.size).toBe(1872);
    expect(second.qrCodeBox!.y + second.qrCodeBox!.size).toBe(1872);
    expect(first.infoLayout?.lineBoxes).toEqual(second.infoLayout?.lineBoxes);
    expect(first.qrCodeBox?.moduleCount).not.toBe(second.qrCodeBox?.moduleCount);
  });

  it('keeps QR-only output final-only without ghost lines', () => {
    const { canvas, recording } = createShareCardCanvas();
    const plan = renderShareCard(canvas, { qrCode: 'QR only payload' });
    expect(hasExportablePlaceContent({ qrCode: 'QR only payload' })).toBe(true);
    expect(plan.infoLayout?.lineBoxes).toEqual([]);
    expect(recording.fillText).toEqual([]);
  });

  it('keeps one failed QR render isolated from exportability and body geometry', () => {
    const overflow = '海'.repeat(1000);
    const content = {
      storeName: '仍可渲染',
      rating: 4.8,
      category: 'Independent Cafe',
      address: '12 Peace Road, District',
    };
    const withoutQr = createShareCardCanvas();
    const failedQr = createShareCardCanvas();
    const base = renderShareCard(withoutQr.canvas, content);
    const failed = renderShareCard(failedQr.canvas, { ...content, qrCode: overflow });

    expect(failed.qrCodeError).toBe('QR Code 內容過長，請縮短後再試');
    expect(failed.qrCodeMatrix).toBeUndefined();
    expect(failed.qrCodeBox).toBeUndefined();
    expect(line(failed, 'name')?.text).toBe('仍可渲染');
    expect(line(failed, 'category')?.text).toBe('Independent Cafe');
    expect(failed.infoLayout?.lineBoxes).toEqual(base.infoLayout?.lineBoxes);
    expect(failed.name).toEqual(base.name);
    expect(hasExportablePlaceContent({ storeName: '', qrCode: overflow })).toBe(false);
  });
});

describe('photo crop rendering', () => {
  it('passes the requested crop source rect consistently through preview and export renderer calls', () => {
    const source = {} as CanvasImageSource;
    const content = {
      image: {
        naturalWidth: 1600,
        naturalHeight: 900,
        width: 1600,
        height: 900,
        source,
      },
      crop: { zoom: 2, panX: 1, panY: -1 },
      storeName: '海風書店',
      address: '台北市大安區和平東路一段 12 號',
    };
    const preview = createShareCardCanvas();
    const previewPlan = renderShareCard(preview.canvas, content);
    const download = createShareCardCanvas();
    const downloadPlan = renderShareCard(download.canvas, content);
    const previewArgs = preview.recording.drawImage.at(-1)?.args;
    const downloadArgs = download.recording.drawImage.at(-1)?.args;

    // Independent cover calculation for 1600x900 -> 1536x1229 at 2x zoom.
    const expectedSourceHeight = 450;
    const expectedSourceWidth = (1536 * 900) / 2458;
    const expectedSourceX = 1600 - expectedSourceWidth;

    expect(previewPlan.photoCrop?.sourceX).toBeCloseTo(expectedSourceX);
    expect(previewPlan.photoCrop?.sourceY).toBe(0);
    expect(previewPlan.photoCrop?.sourceWidth).toBeCloseTo(expectedSourceWidth);
    expect(previewPlan.photoCrop?.sourceHeight).toBe(expectedSourceHeight);
    expect(previewArgs?.[0]).toBe(source);
    expect(previewArgs?.[1]).toBeCloseTo(expectedSourceX);
    expect(previewArgs?.[2]).toBe(0);
    expect(previewArgs?.[3]).toBeCloseTo(expectedSourceWidth);
    expect(previewArgs?.[4]).toBe(expectedSourceHeight);
    expect(previewArgs?.slice(5)).toEqual([0, 0, 1536, 1229]);
    expect(downloadPlan.photoCrop).toEqual(previewPlan.photoCrop);
    expect(downloadArgs).toEqual(previewArgs);
  });
});

describe('image loading state', () => {
  it('keeps download unavailable until delayed image loading completes', () => {
    const loading = beginImageLoad('blob:new');
    expect(loading.loading).toBe(true);
    expect(canDownload(loading)).toBe(false);

    const ready = completeImageLoad(loading, 'blob:new', {
      naturalWidth: 10,
      naturalHeight: 10,
      width: 10,
      height: 10,
    });
    expect(ready).not.toBeNull();
    expect(canDownload(ready!)).toBe(true);
  });

  it('ignores old image success and error without changing the current load state', () => {
    const currentLoading = beginImageLoad('blob:current');
    const staleImage = {
      naturalWidth: 10,
      naturalHeight: 10,
      width: 10,
      height: 10,
    };
    expect(completeImageLoad(currentLoading, 'blob:old', staleImage)).toBeNull();
    expect(failImageLoad(currentLoading, 'blob:old')).toBeNull();
    expect(currentLoading).toEqual({ image: null, objectUrl: 'blob:current', loading: true });

    const failed = failImageLoad(currentLoading, 'blob:current');
    expect(failed).toEqual({ image: null, objectUrl: null, loading: false });
    expect(canDownload(failed!)).toBe(true);
  });
});
