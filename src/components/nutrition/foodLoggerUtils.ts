import { format } from 'date-fns';

export type MeasurementUnit = 'serving' | 'g' | 'oz' | 'lb' | 'kg' | 'ml';

type MeasurementCategory = 'serving' | 'mass' | 'volume';

const MASS_UNIT_TO_GRAMS: Record<Extract<MeasurementUnit, 'g' | 'oz' | 'lb' | 'kg'>, number> = {
  g: 1,
  oz: 28.349523125,
  lb: 453.59237,
  kg: 1000,
};

function normalizeMeasurementUnit(unitRaw: string | null | undefined): MeasurementUnit | null {
  if (!unitRaw) return null;

  const normalized = unitRaw.trim().toLowerCase();

  switch (normalized) {
    case 'serving':
    case 'servings':
      return 'serving';
    case 'g':
    case 'gram':
    case 'grams':
      return 'g';
    case 'oz':
    case 'ounce':
    case 'ounces':
      return 'oz';
    case 'lb':
    case 'lbs':
    case 'pound':
    case 'pounds':
      return 'lb';
    case 'kg':
    case 'kilogram':
    case 'kilograms':
      return 'kg';
    case 'ml':
    case 'milliliter':
    case 'milliliters':
    case 'millilitre':
    case 'millilitres':
      return 'ml';
    default:
      return null;
  }
}

function getMeasurementCategory(unit: MeasurementUnit): MeasurementCategory {
  if (unit === 'serving') return 'serving';
  if (unit === 'ml') return 'volume';
  return 'mass';
}

function convertAmountBetweenUnits(amount: number, fromUnit: MeasurementUnit, toUnit: MeasurementUnit): number | null {
  if (fromUnit === toUnit) return amount;

  const fromCategory = getMeasurementCategory(fromUnit);
  const toCategory = getMeasurementCategory(toUnit);

  if (fromCategory !== toCategory || fromCategory === 'serving') {
    return null;
  }

  if (fromCategory === 'mass') {
    const grams = amount * MASS_UNIT_TO_GRAMS[fromUnit as Extract<MeasurementUnit, 'g' | 'oz' | 'lb' | 'kg'>];
    return grams / MASS_UNIT_TO_GRAMS[toUnit as Extract<MeasurementUnit, 'g' | 'oz' | 'lb' | 'kg'>];
  }

  if (fromCategory === 'volume') {
    return amount;
  }

  return null;
}

export function getCompatibleMeasurementUnits(servingUnitRaw: string | null | undefined): MeasurementUnit[] {
  const normalizedServingUnit = normalizeMeasurementUnit(servingUnitRaw);
  if (!normalizedServingUnit) return ['serving'];

  const category = getMeasurementCategory(normalizedServingUnit);
  if (category === 'mass') {
    return ['serving', 'g', 'oz', 'lb', 'kg'];
  }

  if (category === 'volume') {
    return ['serving', 'ml'];
  }

  return ['serving'];
}

export function computeServingsFromAmount(input: {
  amount: number;
  amountUnitRaw: string;
  servingSize: number;
  servingUnitRaw: string;
}): number | null {
  const { amount, amountUnitRaw, servingSize, servingUnitRaw } = input;

  if (!Number.isFinite(amount) || amount <= 0) return null;

  const amountUnit = normalizeMeasurementUnit(amountUnitRaw);
  if (!amountUnit) return null;
  if (amountUnit === 'serving') return amount;

  const servingUnit = normalizeMeasurementUnit(servingUnitRaw);
  if (!servingUnit) return null;

  if (!Number.isFinite(servingSize) || servingSize <= 0) return null;
  if (servingUnit === 'serving') return null;

  const amountInServingUnit = convertAmountBetweenUnits(amount, amountUnit, servingUnit);
  if (amountInServingUnit === null) return null;

  const servings = amountInServingUnit / servingSize;
  return Number.isFinite(servings) ? servings : null;
}

export function computeAmountFromServings(input: {
  servings: number;
  targetUnitRaw: string;
  servingSize: number;
  servingUnitRaw: string;
}): number | null {
  const { servings, targetUnitRaw, servingSize, servingUnitRaw } = input;

  if (!Number.isFinite(servings) || servings <= 0) return null;

  const targetUnit = normalizeMeasurementUnit(targetUnitRaw);
  if (!targetUnit) return null;
  if (targetUnit === 'serving') return servings;

  const servingUnit = normalizeMeasurementUnit(servingUnitRaw);
  if (!servingUnit) return null;

  if (!Number.isFinite(servingSize) || servingSize <= 0) return null;
  if (servingUnit === 'serving') return null;

  const amountInServingUnit = servings * servingSize;
  const convertedAmount = convertAmountBetweenUnits(amountInServingUnit, servingUnit, targetUnit);

  if (convertedAmount === null || !Number.isFinite(convertedAmount)) {
    return null;
  }

  return convertedAmount;
}

export function toLocalTimeInput(dateIso: string | null, fallbackDate: Date): string {
  const source = dateIso ? new Date(dateIso) : new Date(fallbackDate);
  if (Number.isNaN(source.getTime())) return '12:00';
  return format(source, 'HH:mm');
}

export function buildLoggedAt(selectedDate: Date, timeValue: string): string {
  const [hoursRaw = '12', minutesRaw = '00'] = (timeValue || '12:00').split(':');
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);

  const localDate = new Date(selectedDate);
  localDate.setHours(
    Number.isFinite(hours) ? hours : 12,
    Number.isFinite(minutes) ? minutes : 0,
    0,
    0
  );

  return localDate.toISOString();
}

export function hasMissingColumnError(error: unknown, columnName: string): boolean {
  const message = (error as { message?: string } | null)?.message?.toLowerCase() || '';
  return (
    message.includes(columnName.toLowerCase()) &&
    (message.includes('does not exist') || message.includes('schema cache'))
  );
}

export function shouldDropColumn(error: unknown, columnName: string): boolean {
  return hasMissingColumnError(error, columnName);
}

export function normalizeFoodName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function numbersNearlyEqual(a: number, b: number, epsilon = 0.05): boolean {
  return Math.abs(a - b) <= epsilon;
}
