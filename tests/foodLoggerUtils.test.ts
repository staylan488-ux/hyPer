import { describe, expect, it } from 'vitest';

import {
  buildLoggedAt,
  computeAmountFromServings,
  computeServingsFromAmount,
  getCompatibleMeasurementUnits,
  hasMissingColumnError,
  normalizeFoodName,
  numbersNearlyEqual,
  shouldDropColumn,
  toLocalTimeInput,
} from '@/components/nutrition/foodLoggerUtils';

describe('foodLoggerUtils', () => {
  it('builds logged_at string from selected day and time', () => {
    const date = new Date(2026, 1, 14, 9, 30);
    const loggedAt = buildLoggedAt(date, '07:45');
    const parsed = new Date(loggedAt);

    expect(Number.isNaN(parsed.getTime())).toBe(false);
    expect(loggedAt.endsWith('Z')).toBe(true);
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(1);
    expect(parsed.getDate()).toBe(14);
    expect(parsed.getHours()).toBe(7);
    expect(parsed.getMinutes()).toBe(45);
  });

  it('falls back to noon when time is empty', () => {
    const date = new Date(2026, 5, 1, 8, 0);
    const parsed = new Date(buildLoggedAt(date, ''));

    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(5);
    expect(parsed.getDate()).toBe(1);
    expect(parsed.getHours()).toBe(12);
    expect(parsed.getMinutes()).toBe(0);
  });

  it('formats fallback date into local HH:mm', () => {
    const fallbackDate = new Date(2026, 1, 14, 16, 5);
    expect(toLocalTimeInput(null, fallbackDate)).toBe('16:05');
  });

  it('returns noon for invalid date inputs', () => {
    expect(toLocalTimeInput('invalid-date', new Date(2026, 1, 14, 8, 0))).toBe('12:00');
  });

  it('detects missing-column schema errors', () => {
    const error = { message: 'column nutrition_logs.logged_at does not exist in schema cache' };
    expect(hasMissingColumnError(error, 'logged_at')).toBe(true);
    expect(shouldDropColumn(error, 'logged_at')).toBe(true);
  });

  it('ignores unrelated errors when deciding retries', () => {
    const error = { message: 'permission denied for table nutrition_logs' };
    expect(hasMissingColumnError(error, 'logged_at')).toBe(false);
    expect(shouldDropColumn(error, 'meal_type')).toBe(false);
  });

  it('normalizes meal names for consistent matching', () => {
    expect(normalizeFoodName('  Protein   Shake  ')).toBe('protein shake');
    expect(normalizeFoodName('Chicken	Breast')).toBe('chicken breast');
  });

  it('compares numeric macro values with epsilon tolerance', () => {
    expect(numbersNearlyEqual(24.0, 24.04)).toBe(true);
    expect(numbersNearlyEqual(24.0, 24.2)).toBe(false);
  });

  it('returns mass-compatible measurement options for gram-based foods', () => {
    expect(getCompatibleMeasurementUnits('g')).toEqual(['serving', 'g', 'oz', 'lb', 'kg']);
    expect(getCompatibleMeasurementUnits('grams')).toEqual(['serving', 'g', 'oz', 'lb', 'kg']);
  });

  it('returns volume-compatible options for ml-based foods', () => {
    expect(getCompatibleMeasurementUnits('ml')).toEqual(['serving', 'ml']);
  });

  it('defaults to serving-only options when unit is unknown', () => {
    expect(getCompatibleMeasurementUnits('cup')).toEqual(['serving']);
  });

  it('converts grams to servings using gram-based serving size', () => {
    const servings = computeServingsFromAmount({
      amount: 180,
      amountUnitRaw: 'g',
      servingSize: 100,
      servingUnitRaw: 'g',
    });

    expect(servings).toBeCloseTo(1.8, 5);
  });

  it('converts ounces and pounds to servings for gram-based foods', () => {
    const ozServings = computeServingsFromAmount({
      amount: 6,
      amountUnitRaw: 'oz',
      servingSize: 100,
      servingUnitRaw: 'g',
    });

    const lbServings = computeServingsFromAmount({
      amount: 0.5,
      amountUnitRaw: 'lb',
      servingSize: 100,
      servingUnitRaw: 'g',
    });

    expect(ozServings).toBeCloseTo(1.700971, 5);
    expect(lbServings).toBeCloseTo(2.267961, 5);
  });

  it('converts kilograms to servings for gram-based foods', () => {
    const servings = computeServingsFromAmount({
      amount: 0.25,
      amountUnitRaw: 'kg',
      servingSize: 100,
      servingUnitRaw: 'g',
    });

    expect(servings).toBeCloseTo(2.5, 5);
  });

  it('converts milliliters to servings for ml-based foods', () => {
    const servings = computeServingsFromAmount({
      amount: 300,
      amountUnitRaw: 'ml',
      servingSize: 150,
      servingUnitRaw: 'ml',
    });

    expect(servings).toBeCloseTo(2, 5);
  });

  it('returns null for incompatible unit conversions', () => {
    const servings = computeServingsFromAmount({
      amount: 240,
      amountUnitRaw: 'ml',
      servingSize: 100,
      servingUnitRaw: 'g',
    });

    expect(servings).toBeNull();
  });

  it('converts servings to target amount units', () => {
    const grams = computeAmountFromServings({
      servings: 1.5,
      targetUnitRaw: 'g',
      servingSize: 100,
      servingUnitRaw: 'g',
    });

    const ounces = computeAmountFromServings({
      servings: 2,
      targetUnitRaw: 'oz',
      servingSize: 100,
      servingUnitRaw: 'g',
    });

    expect(grams).toBeCloseTo(150, 5);
    expect(ounces).toBeCloseTo(7.054792, 5);
  });

  it('returns null when target unit is incompatible with serving unit', () => {
    const amount = computeAmountFromServings({
      servings: 1,
      targetUnitRaw: 'ml',
      servingSize: 100,
      servingUnitRaw: 'g',
    });

    expect(amount).toBeNull();
  });
});
