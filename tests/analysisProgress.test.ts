import { describe, expect, it } from 'vitest';

import { advanceTrail, sentenceCase, startTrail, trailAnnouncement, type AnalysisTrail } from '@/lib/analysisProgress';
import type { AnalysisProgress } from '@/lib/foodTrial';
import { createSseReader, parseProgress, productLabel, siteLabel, sseEvent, thoughtHeading } from '../supabase/functions/analyze-food-trial/progress';

const words = { photos: 0, hint: "six Trader Joe's chicken tikka samosas" };
const run = (meal: { photos: number; hint: string }, steps: AnalysisProgress[]): AnalysisTrail =>
  steps.reduce((trail, step) => advanceTrail(trail, step, meal), startTrail(meal));
const now = (trail: AnalysisTrail) => trail.lines.map(line => line.now);
const done = (trail: AnalysisTrail) => trail.lines.slice(0, -1).map(line => line.done);

describe('analysis trail', () => {
  it('starts with sending photos, or straight at reading a description', () => {
    expect(now(startTrail({ photos: 1, hint: '' }))).toEqual(['Sending your photo']);
    expect(now(startTrail({ photos: 2, hint: 'lunch' }))).toEqual(['Sending your photos']);
    expect(now(startTrail(words))).toEqual(['Reading your description']);
  });

  it('names what Gemini looks at', () => {
    expect(now(run({ photos: 1, hint: '' }, [{ step: 'look' }]))).toEqual(['Sending your photo', 'Looking at your photo']);
    expect(now(run({ photos: 2, hint: 'with rice' }, [{ step: 'look' }])).at(-1)).toBe('Looking at your photos and description');
    // a description alone was already reading: the server's first step changes nothing
    expect(now(run(words, [{ step: 'look' }]))).toEqual(['Reading your description']);
  });

  it('follows a researched meal in order, past steps in the past tense', () => {
    const trail = run(words, [
      { step: 'look' },
      { step: 'search', products: ["Trader Joe's Chicken Tikka Samosas", 'Kirkland Greek Yogurt'] },
      { step: 'compare', pages: 9 },
      { step: 'read', sites: ['traderjoes.com', 'fatsecret.com'] },
      { step: 'estimate' },
    ]);
    expect(now(trail).at(-1)).toBe('Working out portions and macros');
    expect(done(trail)).toEqual(['Read your description', 'Searched the web', 'Compared 9 pages', 'Read traderjoes.com and fatsecret.com']);
    expect(run(words, [{ step: 'search', products: ['A'] }]).lines.at(-1)?.detail).toBe('A');
    expect(now(run(words, [{ step: 'compare', pages: 1 }])).at(-1)).toBe('Checking the page found');
  });

  it('puts Gemini’s latest heading under the running step, in sentence case', () => {
    const trail = run(words, [{ step: 'look' }, { step: 'thought', text: 'Identifying The Samosas' }, { step: 'thought', text: "Checking Trader Joe's Serving Size" }]);
    expect(trail.lines).toHaveLength(1);
    expect(trail.lines[0].detail).toBe("Checking Trader Joe's serving size");
    // a web step keeps its own detail; the next model step starts clean
    const searching = run(words, [{ step: 'search', products: ['Fixture samosas'] }, { step: 'thought', text: 'Late Heading' }]);
    expect(searching.lines.at(-1)?.detail).toBe('Fixture samosas');
    expect(run(words, [{ step: 'thought', text: 'Old' }, { step: 'estimate' }]).lines.at(-1)?.detail).toBeNull();
  });

  it('never repeats a step', () => {
    const once = run(words, [{ step: 'search', products: ['A'] }, { step: 'estimate' }]);
    expect(advanceTrail(once, { step: 'search', products: ['A'] }, words)).toBe(once);
  });

  it('keeps names, acronyms and I while lowering title case', () => {
    expect(sentenceCase('Estimating The Portion Size')).toBe('Estimating the portion size');
    expect(sentenceCase('Matching USDA Records For Kirkland Bars', 'kirkland protein bar · Kirkland Signature Protein Bar')).toBe('Matching USDA records for Kirkland bars');
    expect(sentenceCase("Checking What I'm Missing")).toBe("Checking what I'm missing");
    expect(sentenceCase('reading the iPhone Photo')).toBe('Reading the iPhone photo');
  });

  it('announces each step once, with the products searched for', () => {
    expect(trailAnnouncement(run(words, [{ step: 'search', products: ['Fixture samosas'] }]))).toBe('Searching the web: Fixture samosas');
    expect(trailAnnouncement(run(words, [{ step: 'estimate' }, { step: 'thought', text: 'Adding Up' }]))).toBe('Working out portions and macros');
  });
});

describe('analysis steps on the wire', () => {
  it('takes only the bold heading of a thought summary', () => {
    expect(thoughtHeading('**Analyzing the Meal**\n\nI am looking at the plate.\n\n**Estimating Portions**\n\nThe rice')).toBe('Estimating Portions');
    expect(thoughtHeading('No heading yet')).toBeNull();
    expect(thoughtHeading('**See https://example.com**')).toBeNull();
    expect(thoughtHeading('**12 34**')).toBeNull();
  });

  it('names products and sites as people say them', () => {
    expect(productLabel({ brand: "Trader Joe's", product: 'Chicken Tikka Samosas', variant: '' })).toBe("Trader Joe's Chicken Tikka Samosas");
    expect(siteLabel('https://www.traderjoes.com/home/products/pdp/123')).toBe('traderjoes.com');
    expect(siteLabel('not a url')).toBeNull();
  });

  it('accepts only well-formed steps', () => {
    expect(parseProgress({ type: 'progress', step: 'search', products: ['A', 'B'] })).toEqual({ step: 'search', products: ['A', 'B'] });
    expect(parseProgress({ step: 'compare', pages: 4 })).toEqual({ step: 'compare', pages: 4 });
    for (const bad of [null, [], { step: 'search', products: [] }, { step: 'search', products: ['a', 'b', 'c'] }, { step: 'compare', pages: -1 },
      { step: 'compare', pages: 1.5 }, { step: 'read', sites: [7] }, { step: 'thought', text: 'x'.repeat(81) }, { step: 'unknown' }]) {
      expect(parseProgress(bad)).toBeNull();
    }
  });

  it('reads server-sent events split anywhere, in any line ending', () => {
    const seen: string[] = [];
    const reader = createSseReader(data => seen.push(data));
    const wire = `${sseEvent({ a: 1 })}: comment\n\n${'data: {"b":2}\r\n\r\n'}data: {"c":\ndata: 3}\n\ndata: {"d":4}`;
    for (const piece of wire.match(/[\s\S]{1,3}/g)!) reader.push(piece);
    expect(seen).toEqual(['{"a":1}', '{"b":2}', '{"c":\n3}']);
    reader.end();
    expect(seen.at(-1)).toBe('{"d":4}');
  });
});
